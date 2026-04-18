// Credit repository — monthly MiMo credit limit enforcement with per-user
// date-range overrides.
//
// Credits are what MiMo actually bills. For mimo-v2-pro that is
// 2 × (prompt + completion + cache_creation + cache_read); for mimo-v2-omni,
// 1×; for mimo-v2-tts, 0×; for anything else, NULL (excluded from sums).
// The per-request value is populated into request_logs.estimated_credits by
// src/server/lib/credit-calculator.ts.
//
// Design mirrors quota.ts, but the window is monthly (not daily) and override
// activation is checked against **today's UTC date**, not the window start.
// That matters because a monthly window can span 30+ days: an override with
// start_date mid-month would never activate if we compared against windowStart
// (= month's reset day). Checking against today matches the admin's mental
// model of "active right now".
import type {
  CreditStatus,
  CreditOverride,
  CreditOverrideCreate,
} from '../../../shared/types.js';
import { getDb } from '../connection.js';
import { get as getSetting } from './settings.js';

const DEFAULT_RESET_DAY = 1;

// ── Reset day & window ─────────────────────────────

export function getCreditResetDay(): number {
  const raw = getSetting('credit_reset_day');
  if (raw == null) return DEFAULT_RESET_DAY;
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_RESET_DAY;
  return Math.max(1, Math.min(28, parsed));
}

/**
 * Compute the current credit window [start, end) in UTC.
 */
export function getCreditWindow(
  resetDay: number,
  now?: Date,
): { start: string; end: string; resetDay: number } {
  const day = Math.max(1, Math.min(28, Math.floor(resetDay)));
  const current = now ?? new Date();

  const thisMonthReset = new Date(Date.UTC(
    current.getUTCFullYear(),
    current.getUTCMonth(),
    day,
    0, 0, 0, 0,
  ));

  let windowStart: Date;
  if (current.getTime() >= thisMonthReset.getTime()) {
    windowStart = thisMonthReset;
  } else {
    windowStart = new Date(Date.UTC(
      current.getUTCFullYear(),
      current.getUTCMonth() - 1,
      day,
      0, 0, 0, 0,
    ));
  }
  const windowEnd = new Date(Date.UTC(
    windowStart.getUTCFullYear(),
    windowStart.getUTCMonth() + 1,
    day,
    0, 0, 0, 0,
  ));

  return {
    start: windowStart.toISOString().replace('T', ' ').slice(0, 19),
    end: windowEnd.toISOString().replace('T', ' ').slice(0, 19),
    resetDay: day,
  };
}

/** Current UTC date as YYYY-MM-DD — used for override activation checks. */
function todayUtc(now?: Date): string {
  return (now ?? new Date()).toISOString().slice(0, 10);
}

// ── Usage in window ────────────────────────────────

export function getCreditsUsedInWindow(userId: string, windowStart: string): number {
  const db = getDb();
  const row = db.prepare(`
    SELECT COALESCE(SUM(estimated_credits), 0) as total
    FROM request_logs
    WHERE user_id = ?
      AND datetime(created_at) >= datetime(?)
      AND estimated_credits IS NOT NULL
      AND status = 'success'
  `).get(userId, windowStart) as { total: number };
  return row.total;
}

// ── Overrides ──────────────────────────────────────

export function getActiveCreditOverride(
  userId: string,
  asOfDate: string,
): CreditOverride | undefined {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM credit_overrides
    WHERE user_id = ?
      AND start_date <= ?
      AND end_date >= ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(userId, asOfDate, asOfDate) as CreditOverride | undefined;
}

export function listCreditOverrides(userId: string): CreditOverride[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM credit_overrides WHERE user_id = ? ORDER BY start_date DESC',
  ).all(userId) as CreditOverride[];
}

export function createCreditOverride(
  userId: string,
  data: CreditOverrideCreate,
): CreditOverride {
  const db = getDb();
  return db.prepare(`
    INSERT INTO credit_overrides (user_id, start_date, end_date, max_credits, note)
    VALUES (?, ?, ?, ?, ?)
    RETURNING *
  `).get(userId, data.start_date, data.end_date, data.max_credits, data.note ?? null) as CreditOverride;
}

export function deleteCreditOverride(id: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM credit_overrides WHERE id = ?').run(id);
  return result.changes > 0;
}

// ── Effective limit ────────────────────────────────

interface EffectiveLimit {
  limit: number | null;
  source: 'override' | 'user' | 'default' | 'none';
  overrideId?: string;
}

export function getEffectiveCreditLimit(userId: string): EffectiveLimit {
  const override = getActiveCreditOverride(userId, todayUtc());
  if (override) {
    return { limit: override.max_credits, source: 'override', overrideId: override.id };
  }

  const db = getDb();
  const user = db.prepare('SELECT credit_limit FROM users WHERE id = ?').get(userId) as
    { credit_limit: number | null } | undefined;

  if (user?.credit_limit != null) {
    if (user.credit_limit === -1) {
      return { limit: null, source: 'none' };
    }
    return { limit: user.credit_limit, source: 'user' };
  }

  const globalDefault = getSetting('credit_limit_default');
  if (globalDefault != null) {
    const parsed = parseInt(globalDefault, 10);
    if (!isNaN(parsed)) {
      if (parsed === -1) return { limit: null, source: 'none' };
      return { limit: parsed, source: 'default' };
    }
  }

  return { limit: null, source: 'none' };
}

// ── Credit check (enforcement) ─────────────────────

export function checkCreditLimit(userId: string): { allowed: boolean; status: CreditStatus } {
  const status = getCreditStatus(userId);
  const allowed = status.credit_limit === null || status.credits_used < status.credit_limit;
  return { allowed, status };
}

// ── Full status (for API display) ──────────────────

export function getCreditStatus(userId: string): CreditStatus {
  const resetDay = getCreditResetDay();
  const { start, end } = getCreditWindow(resetDay);
  const { limit, source, overrideId } = getEffectiveCreditLimit(userId);
  const creditsUsed = getCreditsUsedInWindow(userId, start);
  const creditsRemaining = limit !== null ? Math.max(0, limit - creditsUsed) : null;

  return {
    credit_limit: limit,
    credit_source: source,
    credits_used: creditsUsed,
    credits_remaining: creditsRemaining,
    window_start: start,
    window_end: end,
    reset_day: resetDay,
    ...(overrideId ? { override_id: overrideId } : {}),
  };
}
