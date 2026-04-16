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

// ── Helpers ────────────────────────────────────────

function insertUser(id = 'user1', quota: number | null = null) {
  db.prepare('INSERT INTO users (id, name, daily_token_quota) VALUES (?, ?, ?)').run(id, 'Test', quota);
}

function insertLog(userId: string, tokens: number, createdAt: string, status = 'success') {
  db.prepare(`
    INSERT INTO request_logs (user_id, prompt_tokens, completion_tokens, cache_creation_input_tokens, cache_read_input_tokens, status, created_at)
    VALUES (?, ?, 0, 0, 0, ?, ?)
  `).run(userId, tokens, status, createdAt);
}

function insertOverride(userId: string, startDate: string, endDate: string, maxTokens: number, createdAt?: string) {
  if (createdAt) {
    db.prepare(`
      INSERT INTO quota_overrides (user_id, start_date, end_date, max_tokens, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(userId, startDate, endDate, maxTokens, createdAt);
  } else {
    db.prepare(`
      INSERT INTO quota_overrides (user_id, start_date, end_date, max_tokens)
      VALUES (?, ?, ?, ?)
    `).run(userId, startDate, endDate, maxTokens);
  }
}

// ── getQuotaWindow ─────────────────────────────────

describe('getQuotaWindow', () => {
  it('returns correct window when current time is after reset', async () => {
    const { getQuotaWindow } = await import('../src/server/db/repositories/quota.js');
    // 2026-04-16 at 10:00 UTC, reset at 00:00
    const now = new Date('2026-04-16T10:00:00Z');
    const result = getQuotaWindow('00:00', now);

    expect(result.start).toBe('2026-04-16 00:00:00');
    expect(result.end).toBe('2026-04-17 00:00:00');
    expect(result.quotaDate).toBe('2026-04-16');
  });

  it('returns previous day window when current time is before reset', async () => {
    const { getQuotaWindow } = await import('../src/server/db/repositories/quota.js');
    // 2026-04-16 at 03:00 UTC, reset at 06:00
    const now = new Date('2026-04-16T03:00:00Z');
    const result = getQuotaWindow('06:00', now);

    expect(result.start).toBe('2026-04-15 06:00:00');
    expect(result.end).toBe('2026-04-16 06:00:00');
    expect(result.quotaDate).toBe('2026-04-15');
  });

  it('window starts at reset time when current time equals reset', async () => {
    const { getQuotaWindow } = await import('../src/server/db/repositories/quota.js');
    const now = new Date('2026-04-16T06:00:00Z');
    const result = getQuotaWindow('06:00', now);

    expect(result.start).toBe('2026-04-16 06:00:00');
    expect(result.end).toBe('2026-04-17 06:00:00');
  });

  it('handles non-zero minutes in reset time', async () => {
    const { getQuotaWindow } = await import('../src/server/db/repositories/quota.js');
    const now = new Date('2026-04-16T14:30:00Z');
    const result = getQuotaWindow('14:30', now);

    expect(result.start).toBe('2026-04-16 14:30:00');
    expect(result.end).toBe('2026-04-17 14:30:00');
  });
});

// ── getTokensUsedInWindow ──────────────────────────

describe('getTokensUsedInWindow', () => {
  it('sums tokens correctly within window', async () => {
    const { getTokensUsedInWindow } = await import('../src/server/db/repositories/quota.js');
    insertUser('u1');
    insertLog('u1', 100, '2026-04-16 05:00:00');
    insertLog('u1', 200, '2026-04-16 10:00:00');

    const total = getTokensUsedInWindow('u1', '2026-04-16 00:00:00');
    expect(total).toBe(300);
  });

  it('excludes error-status requests', async () => {
    const { getTokensUsedInWindow } = await import('../src/server/db/repositories/quota.js');
    insertUser('u1');
    insertLog('u1', 100, '2026-04-16 05:00:00', 'success');
    insertLog('u1', 500, '2026-04-16 06:00:00', 'error');

    const total = getTokensUsedInWindow('u1', '2026-04-16 00:00:00');
    expect(total).toBe(100);
  });

  it('excludes requests outside the window', async () => {
    const { getTokensUsedInWindow } = await import('../src/server/db/repositories/quota.js');
    insertUser('u1');
    insertLog('u1', 100, '2026-04-15 23:59:59'); // before window
    insertLog('u1', 200, '2026-04-16 01:00:00'); // in window

    const total = getTokensUsedInWindow('u1', '2026-04-16 00:00:00');
    expect(total).toBe(200);
  });

  it('returns 0 when no logs exist', async () => {
    const { getTokensUsedInWindow } = await import('../src/server/db/repositories/quota.js');
    insertUser('u1');
    const total = getTokensUsedInWindow('u1', '2026-04-16 00:00:00');
    expect(total).toBe(0);
  });
});

// ── getActiveOverride ──────────────────────────────

describe('getActiveOverride', () => {
  it('returns matching override for current date', async () => {
    const { getActiveOverride } = await import('../src/server/db/repositories/quota.js');
    insertUser('u1');
    insertOverride('u1', '2026-04-15', '2026-04-20', 5000);

    const override = getActiveOverride('u1', '2026-04-16');
    expect(override).toBeDefined();
    expect(override!.max_tokens).toBe(5000);
  });

  it('returns undefined when no active override', async () => {
    const { getActiveOverride } = await import('../src/server/db/repositories/quota.js');
    insertUser('u1');
    insertOverride('u1', '2026-04-10', '2026-04-12', 5000);

    const override = getActiveOverride('u1', '2026-04-16');
    expect(override).toBeUndefined();
  });

  it('latest created_at wins when overlapping', async () => {
    const { getActiveOverride } = await import('../src/server/db/repositories/quota.js');
    insertUser('u1');
    insertOverride('u1', '2026-04-15', '2026-04-20', 5000, '2026-04-15 10:00:00');
    insertOverride('u1', '2026-04-15', '2026-04-20', 9000, '2026-04-16 10:00:00');

    const override = getActiveOverride('u1', '2026-04-16');
    expect(override).toBeDefined();
    expect(override!.max_tokens).toBe(9000);
  });
});

// ── getEffectiveLimit ──────────────────────────────

describe('getEffectiveLimit', () => {
  it('uses override when active', async () => {
    const { getEffectiveLimit } = await import('../src/server/db/repositories/quota.js');
    insertUser('u1', 1000);
    // Insert override covering today's quota date
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    insertOverride('u1', todayStr, todayStr, 5000);

    const result = getEffectiveLimit('u1');
    expect(result.limit).toBe(5000);
    expect(result.source).toBe('override');
    expect(result.overrideId).toBeDefined();
  });

  it('falls back to user daily_token_quota', async () => {
    const { getEffectiveLimit } = await import('../src/server/db/repositories/quota.js');
    insertUser('u1', 2000);

    const result = getEffectiveLimit('u1');
    expect(result.limit).toBe(2000);
    expect(result.source).toBe('user');
  });

  it('returns null (unlimited) when no quota set and no global default', async () => {
    const { getEffectiveLimit } = await import('../src/server/db/repositories/quota.js');
    insertUser('u1', null);

    const result = getEffectiveLimit('u1');
    expect(result.limit).toBeNull();
    expect(result.source).toBe('none');
  });

  it('falls back to global default when user has no per-user quota', async () => {
    const { getEffectiveLimit } = await import('../src/server/db/repositories/quota.js');
    insertUser('u1', null);
    // Set global default via settings
    db.prepare("INSERT INTO settings (key, value) VALUES ('quota_default_limit', '5000000')").run();

    const result = getEffectiveLimit('u1');
    expect(result.limit).toBe(5000000);
    expect(result.source).toBe('default');
  });

  it('per-user quota takes priority over global default', async () => {
    const { getEffectiveLimit } = await import('../src/server/db/repositories/quota.js');
    insertUser('u1', 2000);
    db.prepare("INSERT INTO settings (key, value) VALUES ('quota_default_limit', '5000000')").run();

    const result = getEffectiveLimit('u1');
    expect(result.limit).toBe(2000);
    expect(result.source).toBe('user');
  });

  it('user with -1 is explicitly unlimited even with global default', async () => {
    const { getEffectiveLimit } = await import('../src/server/db/repositories/quota.js');
    insertUser('u1', -1);
    db.prepare("INSERT INTO settings (key, value) VALUES ('quota_default_limit', '5000000')").run();

    const result = getEffectiveLimit('u1');
    expect(result.limit).toBeNull();
    expect(result.source).toBe('none');
  });
});

// ── checkQuota ─────────────────────────────────────

describe('checkQuota', () => {
  it('allows when under quota', async () => {
    const { checkQuota } = await import('../src/server/db/repositories/quota.js');
    insertUser('u1', 1000);

    const { allowed, status } = checkQuota('u1');
    expect(allowed).toBe(true);
    expect(status.quota_limit).toBe(1000);
    expect(status.tokens_used).toBe(0);
    expect(status.tokens_remaining).toBe(1000);
  });

  it('blocks when over quota', async () => {
    const { checkQuota, getQuotaWindow } = await import('../src/server/db/repositories/quota.js');
    insertUser('u1', 100);
    const { start } = getQuotaWindow('00:00');
    // Insert log within current window
    insertLog('u1', 150, start);

    const { allowed, status } = checkQuota('u1');
    expect(allowed).toBe(false);
    expect(status.tokens_used).toBe(150);
    expect(status.quota_limit).toBe(100);
    expect(status.tokens_remaining).toBe(0);
  });

  it('allows when user has no quota (unlimited)', async () => {
    const { checkQuota } = await import('../src/server/db/repositories/quota.js');
    insertUser('u1', null);

    const { allowed, status } = checkQuota('u1');
    expect(allowed).toBe(true);
    expect(status.quota_limit).toBeNull();
    expect(status.tokens_remaining).toBeNull();
    expect(status.quota_source).toBe('none');
  });

  it('uses override limit over user default', async () => {
    const { checkQuota, getQuotaWindow } = await import('../src/server/db/repositories/quota.js');
    insertUser('u1', 100); // user limit = 100
    const { start, quotaDate } = getQuotaWindow('00:00');
    insertLog('u1', 150, start);
    // Override raises limit to 500
    insertOverride('u1', quotaDate, quotaDate, 500);

    const { allowed, status } = checkQuota('u1');
    expect(allowed).toBe(true);
    expect(status.quota_limit).toBe(500);
    expect(status.quota_source).toBe('override');
    expect(status.tokens_used).toBe(150);
  });
});

// ── Override CRUD ──────────────────────────────────

describe('override CRUD', () => {
  it('creates and lists overrides', async () => {
    const { createOverride, listOverrides } = await import('../src/server/db/repositories/quota.js');
    insertUser('u1');

    const override = createOverride('u1', {
      start_date: '2026-04-15',
      end_date: '2026-04-20',
      max_tokens: 5000,
      note: 'temp increase',
    });
    expect(override.id).toBeTruthy();
    expect(override.max_tokens).toBe(5000);
    expect(override.note).toBe('temp increase');

    const list = listOverrides('u1');
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(override.id);
  });

  it('deletes overrides', async () => {
    const { createOverride, deleteOverride, listOverrides } = await import('../src/server/db/repositories/quota.js');
    insertUser('u1');
    const override = createOverride('u1', {
      start_date: '2026-04-15',
      end_date: '2026-04-20',
      max_tokens: 5000,
    });

    const deleted = deleteOverride(override.id);
    expect(deleted).toBe(true);
    expect(listOverrides('u1')).toHaveLength(0);
  });

  it('delete returns false for non-existent override', async () => {
    const { deleteOverride } = await import('../src/server/db/repositories/quota.js');
    expect(deleteOverride('nonexistent')).toBe(false);
  });
});
