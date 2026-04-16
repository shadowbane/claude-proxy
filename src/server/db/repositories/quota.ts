// Quota repository — daily token quota enforcement, window calculation, overrides
import type { QuotaOverride, QuotaOverrideCreate, QuotaStatus } from '../../../shared/types.js';
import { getDb } from '../connection.js';
import { get as getSetting } from './settings.js';

// ── Reset time & window ────────────────────────────

export function getQuotaResetTime(): string {
  return getSetting('quota_reset_time') ?? '00:00';
}

/**
 * Compute the current quota window boundaries in UTC.
 * If reset time is "06:00" and current UTC is 08:00, window is today 06:00 → tomorrow 06:00.
 * If reset time is "06:00" and current UTC is 03:00, window is yesterday 06:00 → today 06:00.
 */
export function getQuotaWindow(resetTimeHHMM: string, now?: Date): { start: string; end: string; quotaDate: string } {
  const [hours, minutes] = resetTimeHHMM.split(':').map(Number);
  const current = now ?? new Date();

  const todayReset = new Date(Date.UTC(
    current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate(),
    hours, minutes, 0, 0,
  ));

  let windowStart: Date;
  if (current >= todayReset) {
    windowStart = todayReset;
  } else {
    windowStart = new Date(todayReset.getTime() - 24 * 60 * 60 * 1000);
  }
  const windowEnd = new Date(windowStart.getTime() + 24 * 60 * 60 * 1000);

  // quotaDate is the calendar date the window started on
  const quotaDate = windowStart.toISOString().slice(0, 10);

  return {
    start: windowStart.toISOString().replace('T', ' ').slice(0, 19),
    end: windowEnd.toISOString().replace('T', ' ').slice(0, 19),
    quotaDate,
  };
}

// ── Usage in window ────────────────────────────────

export function getTokensUsedInWindow(userId: string, windowStart: string): number {
  const db = getDb();
  const row = db.prepare(`
    SELECT COALESCE(
      SUM(prompt_tokens + completion_tokens), 0
    ) as total
    FROM request_logs
    WHERE user_id = ?
      AND datetime(created_at) >= datetime(?)
      AND status = 'success'
  `).get(userId, windowStart) as { total: number };
  return row.total;
}

// ── Overrides ──────────────────────────────────────

export function getActiveOverride(userId: string, quotaDate: string): QuotaOverride | undefined {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM quota_overrides
    WHERE user_id = ?
      AND start_date <= ?
      AND end_date >= ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(userId, quotaDate, quotaDate) as QuotaOverride | undefined;
}

export function listOverrides(userId: string): QuotaOverride[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM quota_overrides WHERE user_id = ? ORDER BY start_date DESC',
  ).all(userId) as QuotaOverride[];
}

export function createOverride(userId: string, data: QuotaOverrideCreate): QuotaOverride {
  const db = getDb();
  return db.prepare(`
    INSERT INTO quota_overrides (user_id, start_date, end_date, max_tokens, note)
    VALUES (?, ?, ?, ?, ?)
    RETURNING *
  `).get(userId, data.start_date, data.end_date, data.max_tokens, data.note ?? null) as QuotaOverride;
}

export function deleteOverride(id: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM quota_overrides WHERE id = ?').run(id);
  return result.changes > 0;
}

// ── Effective limit ────────────────────────────────

interface EffectiveLimit {
  limit: number | null;
  source: 'override' | 'user' | 'default' | 'none';
  overrideId?: string;
}

export function getEffectiveLimit(userId: string): EffectiveLimit {
  const resetTime = getQuotaResetTime();
  const { quotaDate } = getQuotaWindow(resetTime);
  const override = getActiveOverride(userId, quotaDate);

  if (override) {
    return { limit: override.max_tokens, source: 'override', overrideId: override.id };
  }

  const db = getDb();
  const user = db.prepare('SELECT daily_token_quota FROM users WHERE id = ?').get(userId) as
    { daily_token_quota: number | null } | undefined;

  if (user?.daily_token_quota != null) {
    // -1 means explicitly unlimited (bypass global default)
    if (user.daily_token_quota === -1) {
      return { limit: null, source: 'none' };
    }
    return { limit: user.daily_token_quota, source: 'user' };
  }

  // Fall back to global default
  const globalDefault = getSetting('quota_default_limit');
  if (globalDefault != null) {
    const parsed = parseInt(globalDefault, 10);
    if (!isNaN(parsed)) {
      return { limit: parsed, source: 'default' };
    }
  }

  return { limit: null, source: 'none' };
}

// ── Quota check (enforcement) ──────────────────────

export function checkQuota(userId: string): { allowed: boolean; status: QuotaStatus } {
  const status = getQuotaStatus(userId);
  const allowed = status.quota_limit === null || status.tokens_used < status.quota_limit;
  return { allowed, status };
}

// ── Full status (for API display) ──────────────────

export function getQuotaStatus(userId: string): QuotaStatus {
  const resetTime = getQuotaResetTime();
  const { start, end, quotaDate } = getQuotaWindow(resetTime);
  const override = getActiveOverride(userId, quotaDate);

  let quotaLimit: number | null;
  let quotaSource: 'override' | 'user' | 'default' | 'none';
  let overrideId: string | undefined;

  if (override) {
    quotaLimit = override.max_tokens;
    quotaSource = 'override';
    overrideId = override.id;
  } else {
    const db = getDb();
    const user = db.prepare('SELECT daily_token_quota FROM users WHERE id = ?').get(userId) as
      { daily_token_quota: number | null } | undefined;
    if (user?.daily_token_quota != null) {
      if (user.daily_token_quota === -1) {
        // Explicitly unlimited — bypass global default
        quotaLimit = null;
        quotaSource = 'none';
      } else {
        quotaLimit = user.daily_token_quota;
        quotaSource = 'user';
      }
    } else {
      // Fall back to global default
      const globalDefault = getSetting('quota_default_limit');
      if (globalDefault != null) {
        const parsed = parseInt(globalDefault, 10);
        if (!isNaN(parsed)) {
          quotaLimit = parsed;
          quotaSource = 'default';
        } else {
          quotaLimit = null;
          quotaSource = 'none';
        }
      } else {
        quotaLimit = null;
        quotaSource = 'none';
      }
    }
  }

  const tokensUsed = getTokensUsedInWindow(userId, start);
  const tokensRemaining = quotaLimit !== null ? Math.max(0, quotaLimit - tokensUsed) : null;

  return {
    quota_limit: quotaLimit,
    quota_source: quotaSource,
    tokens_used: tokensUsed,
    tokens_remaining: tokensRemaining,
    window_start: start,
    window_end: end,
    ...(overrideId ? { override_id: overrideId } : {}),
  };
}
