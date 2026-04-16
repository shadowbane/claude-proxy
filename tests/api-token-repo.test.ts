import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { createTestDb, seedTestAdmin, mockGetDb } from './helpers.js';
import { createUser } from '../src/server/db/repositories/user.js';
import {
  createApiToken,
  findByHash,
  listByUser,
  revokeToken,
  updateToken,
  revealToken,
  touchLastUsed,
  flushPendingTouches,
} from '../src/server/db/repositories/api-token.js';
import { hashToken } from '../src/server/lib/crypto.js';

let db: Database.Database;
let adminId: string;
let userId: string;

beforeEach(async () => {
  db = createTestDb();
  mockGetDb(db);
  const admin = await seedTestAdmin(db);
  adminId = admin.id;
  const user = createUser({ name: 'Test User' }, adminId);
  userId = user.id;
});

afterEach(() => {
  db.close();
  vi.restoreAllMocks();
});

// ── createApiToken ──────────────────────────────────

describe('createApiToken', () => {
  it('creates a token and returns raw + masked row', () => {
    const { raw, token } = createApiToken(userId, 'my-key');

    expect(raw).toMatch(/^cp_live_[a-f0-9]{48}$/);
    expect(token.name).toBe('my-key');
    expect(token.user_id).toBe(userId);
    expect(token.token_prefix).toBe(raw.slice(0, 12) + '...');
    expect(token.enabled).toBe(1);
    expect(token.id).toBeTruthy();
    expect(token.created_at).toBeTruthy();
    // Masked row should NOT contain encryption fields
    expect((token as Record<string, unknown>)['token_hash']).toBeUndefined();
    expect((token as Record<string, unknown>)['token_encrypted']).toBeUndefined();
  });

  it('generates unique tokens', () => {
    const t1 = createApiToken(userId, 'key1');
    const t2 = createApiToken(userId, 'key2');
    expect(t1.raw).not.toBe(t2.raw);
    expect(t1.token.id).not.toBe(t2.token.id);
  });
});

// ── findByHash ──────────────────────────────────────

describe('findByHash', () => {
  it('finds token by SHA-256 hash with user info', () => {
    const { raw } = createApiToken(userId, 'lookup-test');
    const hash = hashToken(raw);

    const found = findByHash(hash);
    expect(found).toBeDefined();
    expect(found!.user_id).toBe(userId);
    expect(found!.user_name).toBe('Test User');
    expect(found!.user_enabled).toBe(1);
  });

  it('returns undefined for unknown hash', () => {
    expect(findByHash('0000000000')).toBeUndefined();
  });
});

// ── listByUser ──────────────────────────────────────

describe('listByUser', () => {
  it('returns empty array when user has no tokens', () => {
    expect(listByUser(userId)).toEqual([]);
  });

  it('returns masked tokens for user', () => {
    createApiToken(userId, 'first');
    createApiToken(userId, 'second');

    const tokens = listByUser(userId);
    expect(tokens).toHaveLength(2);
    const names = tokens.map((t) => t.name);
    expect(names).toContain('first');
    expect(names).toContain('second');
    // Verify masked (no encryption fields)
    expect((tokens[0] as Record<string, unknown>)['token_hash']).toBeUndefined();
  });

  it('does not return tokens from other users', () => {
    const otherUser = createUser({ name: 'Other' }, adminId);
    createApiToken(userId, 'mine');
    createApiToken(otherUser.id, 'theirs');

    const mine = listByUser(userId);
    expect(mine).toHaveLength(1);
    expect(mine[0].name).toBe('mine');
  });
});

// ── revokeToken ─────────────────────────────────────

describe('revokeToken', () => {
  it('deletes a token', () => {
    const { token } = createApiToken(userId, 'to-revoke');
    expect(revokeToken(token.id)).toBe(true);
    expect(listByUser(userId)).toHaveLength(0);
  });

  it('returns false for unknown token', () => {
    expect(revokeToken('nonexistent')).toBe(false);
  });
});

// ── updateToken ─────────────────────────────────────

describe('updateToken', () => {
  it('updates token name', () => {
    const { token } = createApiToken(userId, 'old-name');
    const updated = updateToken(token.id, { name: 'new-name' });

    expect(updated).toBeDefined();
    expect(updated!.name).toBe('new-name');
  });

  it('updates token enabled flag', () => {
    const { token } = createApiToken(userId, 'toggle');
    expect(token.enabled).toBe(1);

    const disabled = updateToken(token.id, { enabled: false });
    expect(disabled!.enabled).toBe(0);

    const enabled = updateToken(token.id, { enabled: true });
    expect(enabled!.enabled).toBe(1);
  });

  it('returns current token when no fields provided', () => {
    const { token } = createApiToken(userId, 'noop');
    const same = updateToken(token.id, {});

    expect(same).toBeDefined();
    expect(same!.name).toBe('noop');
  });

  it('returns undefined for unknown token', () => {
    expect(updateToken('nonexistent', { name: 'ghost' })).toBeUndefined();
  });
});

// ── revealToken ─────────────────────────────────────

describe('revealToken', () => {
  it('decrypts and returns the raw token', () => {
    const { raw, token } = createApiToken(userId, 'reveal-me');
    const revealed = revealToken(token.id);

    expect(revealed).toBe(raw);
  });

  it('returns undefined for unknown token', () => {
    expect(revealToken('nonexistent')).toBeUndefined();
  });
});

// ── touchLastUsed ───────────────────────────────────

describe('touchLastUsed', () => {
  it('sets last_used_at timestamp', () => {
    const { token } = createApiToken(userId, 'touch-me');
    expect(token.last_used_at).toBeNull();

    touchLastUsed(token.id);
    flushPendingTouches();

    const tokens = listByUser(userId);
    expect(tokens[0].last_used_at).toBeTruthy();
  });
});
