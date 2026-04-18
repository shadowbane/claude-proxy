import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { createTestDb, mockGetDb } from './helpers.js';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  mockGetDb(db);
});

afterEach(() => {
  db.close();
  vi.restoreAllMocks();
});

function insertUser(id = 'u1', creditLimit: number | null = null) {
  db.prepare('INSERT INTO users (id, name, credit_limit) VALUES (?, ?, ?)').run(id, 'Test', creditLimit);
}

function insertLog(
  userId: string,
  estimatedCredits: number | null,
  createdAt: string,
  status = 'success',
) {
  db.prepare(`
    INSERT INTO request_logs (user_id, prompt_tokens, completion_tokens, cache_creation_input_tokens, cache_read_input_tokens, estimated_credits, status, created_at)
    VALUES (?, 0, 0, 0, 0, ?, ?, ?)
  `).run(userId, estimatedCredits, status, createdAt);
}

function setSetting(key: string, value: string) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

function insertCreditOverride(
  userId: string,
  startDate: string,
  endDate: string,
  maxCredits: number,
  createdAt?: string,
) {
  if (createdAt) {
    db.prepare(`
      INSERT INTO credit_overrides (user_id, start_date, end_date, max_credits, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(userId, startDate, endDate, maxCredits, createdAt);
  } else {
    db.prepare(`
      INSERT INTO credit_overrides (user_id, start_date, end_date, max_credits)
      VALUES (?, ?, ?, ?)
    `).run(userId, startDate, endDate, maxCredits);
  }
}

// ── getCreditWindow ────────────────────────────────

describe('getCreditWindow', () => {
  it('returns this-month window when now is after reset day', async () => {
    const { getCreditWindow } = await import('../src/server/db/repositories/credit.js');
    const r = getCreditWindow(1, new Date('2026-04-18T13:00:00Z'));
    expect(r.start).toBe('2026-04-01 00:00:00');
    expect(r.end).toBe('2026-05-01 00:00:00');
    expect(r.resetDay).toBe(1);
  });

  it('window start is inclusive at exact boundary', async () => {
    const { getCreditWindow } = await import('../src/server/db/repositories/credit.js');
    const r = getCreditWindow(1, new Date('2026-04-01T00:00:00.000Z'));
    expect(r.start).toBe('2026-04-01 00:00:00');
  });

  it('one ms before boundary rolls back to prior month', async () => {
    const { getCreditWindow } = await import('../src/server/db/repositories/credit.js');
    const r = getCreditWindow(1, new Date('2026-03-31T23:59:59.999Z'));
    expect(r.start).toBe('2026-03-01 00:00:00');
    expect(r.end).toBe('2026-04-01 00:00:00');
  });

  it('pre-reset (day 14 with resetDay=15) falls back to prior month', async () => {
    const { getCreditWindow } = await import('../src/server/db/repositories/credit.js');
    const r = getCreditWindow(15, new Date('2026-04-14T23:59:00Z'));
    expect(r.start).toBe('2026-03-15 00:00:00');
    expect(r.end).toBe('2026-04-15 00:00:00');
  });

  it('exact reset day/time is included in this month window', async () => {
    const { getCreditWindow } = await import('../src/server/db/repositories/credit.js');
    const r = getCreditWindow(15, new Date('2026-04-15T00:00:00Z'));
    expect(r.start).toBe('2026-04-15 00:00:00');
    expect(r.end).toBe('2026-05-15 00:00:00');
  });

  it('one second after reset is inside this month window', async () => {
    const { getCreditWindow } = await import('../src/server/db/repositories/credit.js');
    const r = getCreditWindow(15, new Date('2026-04-15T00:00:01Z'));
    expect(r.start).toBe('2026-04-15 00:00:00');
  });

  it('resetDay=28 in non-leap Feb: day 28 is valid, stays this month', async () => {
    const { getCreditWindow } = await import('../src/server/db/repositories/credit.js');
    const r = getCreditWindow(28, new Date('2026-02-28T12:00:00Z'));
    expect(r.start).toBe('2026-02-28 00:00:00');
    expect(r.end).toBe('2026-03-28 00:00:00');
  });

  it('resetDay=28 pre-reset in Feb rolls back to Jan 28', async () => {
    const { getCreditWindow } = await import('../src/server/db/repositories/credit.js');
    const r = getCreditWindow(28, new Date('2026-02-27T23:59:00Z'));
    expect(r.start).toBe('2026-01-28 00:00:00');
    expect(r.end).toBe('2026-02-28 00:00:00');
  });

  it('resetDay=28 on leap-year Feb 29 stays in Feb', async () => {
    const { getCreditWindow } = await import('../src/server/db/repositories/credit.js');
    const r = getCreditWindow(28, new Date('2024-02-29T10:00:00Z'));
    expect(r.start).toBe('2024-02-28 00:00:00');
    expect(r.end).toBe('2024-03-28 00:00:00');
  });

  it('year rollover: Jan 1 with resetDay=1 starts this month', async () => {
    const { getCreditWindow } = await import('../src/server/db/repositories/credit.js');
    const r = getCreditWindow(1, new Date('2026-01-01T00:00:00Z'));
    expect(r.start).toBe('2026-01-01 00:00:00');
    expect(r.end).toBe('2026-02-01 00:00:00');
  });

  it('year rollover: Dec 31 with resetDay=1 is in Dec window', async () => {
    const { getCreditWindow } = await import('../src/server/db/repositories/credit.js');
    const r = getCreditWindow(1, new Date('2025-12-31T23:59:00Z'));
    expect(r.start).toBe('2025-12-01 00:00:00');
    expect(r.end).toBe('2026-01-01 00:00:00');
  });

  it('month AND year rollback: Jan 14 with resetDay=15 → prior Dec 15', async () => {
    const { getCreditWindow } = await import('../src/server/db/repositories/credit.js');
    const r = getCreditWindow(15, new Date('2026-01-14T00:00:00Z'));
    expect(r.start).toBe('2025-12-15 00:00:00');
    expect(r.end).toBe('2026-01-15 00:00:00');
  });

  it('clamps resetDay=0 up to 1', async () => {
    const { getCreditWindow } = await import('../src/server/db/repositories/credit.js');
    const r = getCreditWindow(0, new Date('2026-04-18T13:00:00Z'));
    expect(r.resetDay).toBe(1);
    expect(r.start).toBe('2026-04-01 00:00:00');
  });

  it('clamps resetDay=31 down to 28 (April 18 is pre-reset → rolls back to Mar 28)', async () => {
    const { getCreditWindow } = await import('../src/server/db/repositories/credit.js');
    const r = getCreditWindow(31, new Date('2026-04-18T13:00:00Z'));
    expect(r.resetDay).toBe(28);
    expect(r.start).toBe('2026-03-28 00:00:00');
    expect(r.end).toBe('2026-04-28 00:00:00');
  });
});

// ── getCreditResetDay ──────────────────────────────

describe('getCreditResetDay', () => {
  it('defaults to 1 when unset', async () => {
    const { getCreditResetDay } = await import('../src/server/db/repositories/credit.js');
    expect(getCreditResetDay()).toBe(1);
  });

  it('reads from settings', async () => {
    setSetting('credit_reset_day', '15');
    const { getCreditResetDay } = await import('../src/server/db/repositories/credit.js');
    expect(getCreditResetDay()).toBe(15);
  });

  it('clamps out-of-range settings value to [1, 28]', async () => {
    setSetting('credit_reset_day', '50');
    const { getCreditResetDay } = await import('../src/server/db/repositories/credit.js');
    expect(getCreditResetDay()).toBe(28);
  });

  it('clamps zero setting to 1', async () => {
    setSetting('credit_reset_day', '0');
    const { getCreditResetDay } = await import('../src/server/db/repositories/credit.js');
    expect(getCreditResetDay()).toBe(1);
  });

  it('falls back to default on non-numeric value', async () => {
    setSetting('credit_reset_day', 'not-a-number');
    const { getCreditResetDay } = await import('../src/server/db/repositories/credit.js');
    expect(getCreditResetDay()).toBe(1);
  });
});

// ── getCreditsUsedInWindow ─────────────────────────

describe('getCreditsUsedInWindow', () => {
  it('sums only success rows with non-null estimated_credits in window', async () => {
    const { getCreditsUsedInWindow } = await import('../src/server/db/repositories/credit.js');
    insertUser('u1');
    insertUser('u2');
    const windowStart = '2026-04-01 00:00:00';

    insertLog('u1', 1000, '2026-04-01 01:00:00');              // in window (A)
    insertLog('u1', 500,  '2026-03-31 23:00:00');              // before window (B)
    insertLog('u1', null, '2026-04-02 00:00:00');              // non-pro — excluded (C)
    insertLog('u1', 0,    '2026-04-03 00:00:00');              // zero-cost — included as 0 (D)
    insertLog('u2', 999,  '2026-04-01 01:00:00');              // other user (E)
    insertLog('u1', 1500, windowStart);                        // boundary inclusive (F)

    expect(getCreditsUsedInWindow('u1', windowStart)).toBe(1000 + 0 + 1500);
  });

  it('returns 0 (not null) when no rows match', async () => {
    const { getCreditsUsedInWindow } = await import('../src/server/db/repositories/credit.js');
    insertUser('u1');
    expect(getCreditsUsedInWindow('u1', '2026-04-01 00:00:00')).toBe(0);
  });

  it('excludes error-status rows', async () => {
    const { getCreditsUsedInWindow } = await import('../src/server/db/repositories/credit.js');
    insertUser('u1');
    insertLog('u1', 1000, '2026-04-01 01:00:00', 'success');
    insertLog('u1', 5000, '2026-04-01 02:00:00', 'error');
    expect(getCreditsUsedInWindow('u1', '2026-04-01 00:00:00')).toBe(1000);
  });
});

// ── getEffectiveCreditLimit ────────────────────────

describe('getEffectiveCreditLimit', () => {
  it('returns unlimited when user null and default null', async () => {
    const { getEffectiveCreditLimit } = await import('../src/server/db/repositories/credit.js');
    insertUser('u1', null);
    const r = getEffectiveCreditLimit('u1');
    expect(r.limit).toBeNull();
    expect(r.source).toBe('none');
  });

  it('returns unlimited when user null and default -1', async () => {
    const { getEffectiveCreditLimit } = await import('../src/server/db/repositories/credit.js');
    insertUser('u1', null);
    setSetting('credit_limit_default', '-1');
    const r = getEffectiveCreditLimit('u1');
    expect(r.limit).toBeNull();
    expect(r.source).toBe('none');
  });

  it('uses global default when user null and default positive', async () => {
    const { getEffectiveCreditLimit } = await import('../src/server/db/repositories/credit.js');
    insertUser('u1', null);
    setSetting('credit_limit_default', '10000');
    const r = getEffectiveCreditLimit('u1');
    expect(r.limit).toBe(10000);
    expect(r.source).toBe('default');
  });

  it('user -1 overrides global default with unlimited', async () => {
    const { getEffectiveCreditLimit } = await import('../src/server/db/repositories/credit.js');
    insertUser('u1', -1);
    setSetting('credit_limit_default', '10000');
    const r = getEffectiveCreditLimit('u1');
    expect(r.limit).toBeNull();
    expect(r.source).toBe('none');
  });

  it('user positive beats global default', async () => {
    const { getEffectiveCreditLimit } = await import('../src/server/db/repositories/credit.js');
    insertUser('u1', 5000);
    setSetting('credit_limit_default', '10000');
    const r = getEffectiveCreditLimit('u1');
    expect(r.limit).toBe(5000);
    expect(r.source).toBe('user');
  });

  it('user 0 is a valid frozen cap (not treated as null)', async () => {
    const { getEffectiveCreditLimit } = await import('../src/server/db/repositories/credit.js');
    insertUser('u1', 0);
    setSetting('credit_limit_default', '10000');
    const r = getEffectiveCreditLimit('u1');
    expect(r.limit).toBe(0);
    expect(r.source).toBe('user');
  });

  it('user positive works without default', async () => {
    const { getEffectiveCreditLimit } = await import('../src/server/db/repositories/credit.js');
    insertUser('u1', 5000);
    const r = getEffectiveCreditLimit('u1');
    expect(r.limit).toBe(5000);
    expect(r.source).toBe('user');
  });
});

// ── checkCreditLimit ───────────────────────────────

describe('checkCreditLimit', () => {
  it('allows when under limit', async () => {
    const { checkCreditLimit, getCreditWindow } = await import('../src/server/db/repositories/credit.js');
    insertUser('u1', 1000);
    const { start } = getCreditWindow(1);
    insertLog('u1', 999, start);
    const { allowed, status } = checkCreditLimit('u1');
    expect(allowed).toBe(true);
    expect(status.credits_used).toBe(999);
    expect(status.credits_remaining).toBe(1);
  });

  it('denies when used equals limit (>= block semantics)', async () => {
    const { checkCreditLimit, getCreditWindow } = await import('../src/server/db/repositories/credit.js');
    insertUser('u1', 1000);
    const { start } = getCreditWindow(1);
    insertLog('u1', 1000, start);
    const { allowed, status } = checkCreditLimit('u1');
    expect(allowed).toBe(false);
    expect(status.credits_used).toBe(1000);
    expect(status.credits_remaining).toBe(0);
  });

  it('denies when used exceeds limit', async () => {
    const { checkCreditLimit, getCreditWindow } = await import('../src/server/db/repositories/credit.js');
    insertUser('u1', 1000);
    const { start } = getCreditWindow(1);
    insertLog('u1', 1500, start);
    const { allowed } = checkCreditLimit('u1');
    expect(allowed).toBe(false);
  });

  it('allows unlimited user regardless of usage', async () => {
    const { checkCreditLimit, getCreditWindow } = await import('../src/server/db/repositories/credit.js');
    insertUser('u1', null);
    const { start } = getCreditWindow(1);
    insertLog('u1', 1_000_000_000, start);
    const { allowed, status } = checkCreditLimit('u1');
    expect(allowed).toBe(true);
    expect(status.credit_limit).toBeNull();
    expect(status.credits_remaining).toBeNull();
  });

  it('denies when user credit_limit is 0 (frozen)', async () => {
    const { checkCreditLimit } = await import('../src/server/db/repositories/credit.js');
    insertUser('u1', 0);
    const { allowed, status } = checkCreditLimit('u1');
    expect(allowed).toBe(false);
    expect(status.credit_limit).toBe(0);
    expect(status.credits_used).toBe(0);
  });
});

// ── getCreditStatus shape ──────────────────────────

describe('getCreditStatus', () => {
  it('returns full status object with all required fields', async () => {
    const { getCreditStatus } = await import('../src/server/db/repositories/credit.js');
    insertUser('u1', 5000);
    setSetting('credit_reset_day', '15');
    const status = getCreditStatus('u1');
    expect(status.credit_limit).toBe(5000);
    expect(status.credit_source).toBe('user');
    expect(status.credits_used).toBe(0);
    expect(status.credits_remaining).toBe(5000);
    expect(status.reset_day).toBe(15);
    expect(status.window_start).toBeTruthy();
    expect(status.window_end).toBeTruthy();
    expect(status.override_id).toBeUndefined();
  });
});

// ── Credit override CRUD ───────────────────────────

describe('credit override CRUD', () => {
  it('creates, lists, and deletes overrides', async () => {
    const { createCreditOverride, listCreditOverrides, deleteCreditOverride } = await import(
      '../src/server/db/repositories/credit.js'
    );
    insertUser('u1');

    const created = createCreditOverride('u1', {
      start_date: '2026-04-15',
      end_date: '2026-04-30',
      max_credits: 500_000_000,
      note: 'conference week',
    });
    expect(created.id).toBeTruthy();
    expect(created.max_credits).toBe(500_000_000);
    expect(created.note).toBe('conference week');

    const list = listCreditOverrides('u1');
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(created.id);

    const deleted = deleteCreditOverride(created.id);
    expect(deleted).toBe(true);
    expect(listCreditOverrides('u1')).toHaveLength(0);
  });

  it('deleteCreditOverride returns false for non-existent id', async () => {
    const { deleteCreditOverride } = await import('../src/server/db/repositories/credit.js');
    expect(deleteCreditOverride('nope')).toBe(false);
  });

  it('createCreditOverride persists null note when omitted', async () => {
    const { createCreditOverride } = await import('../src/server/db/repositories/credit.js');
    insertUser('u1');
    const o = createCreditOverride('u1', {
      start_date: '2026-04-01',
      end_date: '2026-04-30',
      max_credits: 1000,
    });
    expect(o.note).toBeNull();
  });
});

// ── getActiveCreditOverride ────────────────────────

describe('getActiveCreditOverride', () => {
  it('returns matching override when as-of date falls in range', async () => {
    const { getActiveCreditOverride } = await import('../src/server/db/repositories/credit.js');
    insertUser('u1');
    insertCreditOverride('u1', '2026-04-15', '2026-04-30', 5000);

    const o = getActiveCreditOverride('u1', '2026-04-20');
    expect(o).toBeDefined();
    expect(o!.max_credits).toBe(5000);
  });

  it('returns undefined when no overrides active for the date', async () => {
    const { getActiveCreditOverride } = await import('../src/server/db/repositories/credit.js');
    insertUser('u1');
    insertCreditOverride('u1', '2026-04-15', '2026-04-30', 5000);

    expect(getActiveCreditOverride('u1', '2026-05-01')).toBeUndefined();
    expect(getActiveCreditOverride('u1', '2026-04-14')).toBeUndefined();
  });

  it('inclusive on both endpoints', async () => {
    const { getActiveCreditOverride } = await import('../src/server/db/repositories/credit.js');
    insertUser('u1');
    insertCreditOverride('u1', '2026-04-15', '2026-04-30', 5000);

    expect(getActiveCreditOverride('u1', '2026-04-15')).toBeDefined();
    expect(getActiveCreditOverride('u1', '2026-04-30')).toBeDefined();
  });

  it('latest created_at wins when overlapping', async () => {
    const { getActiveCreditOverride } = await import('../src/server/db/repositories/credit.js');
    insertUser('u1');
    insertCreditOverride('u1', '2026-04-15', '2026-04-30', 5000, '2026-04-15 10:00:00');
    insertCreditOverride('u1', '2026-04-15', '2026-04-30', 9000, '2026-04-16 10:00:00');

    const o = getActiveCreditOverride('u1', '2026-04-20');
    expect(o!.max_credits).toBe(9000);
  });

  it('does not leak overrides across users', async () => {
    const { getActiveCreditOverride } = await import('../src/server/db/repositories/credit.js');
    insertUser('u1');
    insertUser('u2');
    insertCreditOverride('u1', '2026-04-01', '2026-04-30', 5000);

    expect(getActiveCreditOverride('u2', '2026-04-15')).toBeUndefined();
  });
});

// ── getEffectiveCreditLimit / getCreditStatus w/ override ──

describe('getEffectiveCreditLimit with overrides', () => {
  it('override takes priority over per-user credit_limit', async () => {
    const { getEffectiveCreditLimit } = await import('../src/server/db/repositories/credit.js');
    insertUser('u1', 1000);
    // Make override active TODAY so we don't have to stub Date
    const today = new Date().toISOString().slice(0, 10);
    insertCreditOverride('u1', today, today, 50000);

    const r = getEffectiveCreditLimit('u1');
    expect(r.limit).toBe(50000);
    expect(r.source).toBe('override');
    expect(r.overrideId).toBeTruthy();
  });

  it('override takes priority over global default', async () => {
    const { getEffectiveCreditLimit } = await import('../src/server/db/repositories/credit.js');
    insertUser('u1', null);
    setSetting('credit_limit_default', '10000');
    const today = new Date().toISOString().slice(0, 10);
    insertCreditOverride('u1', today, today, 99999);

    const r = getEffectiveCreditLimit('u1');
    expect(r.limit).toBe(99999);
    expect(r.source).toBe('override');
  });

  it('expired override does not apply — falls through to per-user limit', async () => {
    const { getEffectiveCreditLimit } = await import('../src/server/db/repositories/credit.js');
    insertUser('u1', 1000);
    insertCreditOverride('u1', '2020-01-01', '2020-01-02', 50000);

    const r = getEffectiveCreditLimit('u1');
    expect(r.limit).toBe(1000);
    expect(r.source).toBe('user');
    expect(r.overrideId).toBeUndefined();
  });

  it('override max_credits=0 freezes the user', async () => {
    const { getEffectiveCreditLimit } = await import('../src/server/db/repositories/credit.js');
    insertUser('u1', 1000);
    const today = new Date().toISOString().slice(0, 10);
    insertCreditOverride('u1', today, today, 0);

    const r = getEffectiveCreditLimit('u1');
    expect(r.limit).toBe(0);
    expect(r.source).toBe('override');
  });
});

describe('getCreditStatus exposes override metadata', () => {
  it('includes override_id and source=override when active', async () => {
    const { getCreditStatus, createCreditOverride } = await import('../src/server/db/repositories/credit.js');
    insertUser('u1', 1000);
    const today = new Date().toISOString().slice(0, 10);
    const o = createCreditOverride('u1', {
      start_date: today,
      end_date: today,
      max_credits: 777,
      note: 'bump',
    });

    const status = getCreditStatus('u1');
    expect(status.credit_limit).toBe(777);
    expect(status.credit_source).toBe('override');
    expect(status.override_id).toBe(o.id);
  });
});
