import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { createTestDb, seedTestAdmin, mockGetDb } from './helpers.js';
import {
  listUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
} from '../src/server/db/repositories/user.js';

let db: Database.Database;
let adminId: string;

beforeEach(async () => {
  db = createTestDb();
  mockGetDb(db);
  const admin = await seedTestAdmin(db);
  adminId = admin.id;
});

afterEach(() => {
  db.close();
  vi.restoreAllMocks();
});

// ── createUser ──────────────────────────────────────

describe('createUser', () => {
  it('creates a user with all fields', () => {
    const user = createUser({ name: 'Alice', email: 'alice@example.com' }, adminId);

    expect(user.name).toBe('Alice');
    expect(user.email).toBe('alice@example.com');
    expect(user.enabled).toBe(1);
    expect(user.created_by).toBe(adminId);
    expect(user.id).toBeTruthy();
    expect(user.created_at).toBeTruthy();
  });

  it('creates a user with only required fields', () => {
    const user = createUser({ name: 'Bob' }, adminId);

    expect(user.name).toBe('Bob');
    expect(user.email).toBeNull();
    expect(user.enabled).toBe(1);
  });

  it('creates a disabled user when enabled=false', () => {
    const user = createUser({ name: 'Charlie', enabled: false }, adminId);

    expect(user.enabled).toBe(0);
  });

  it('generates unique IDs', () => {
    const u1 = createUser({ name: 'User1' }, adminId);
    const u2 = createUser({ name: 'User2' }, adminId);
    expect(u1.id).not.toBe(u2.id);
  });

  it('persists credit_limit when provided', () => {
    const user = createUser({ name: 'CreditUser', credit_limit: 5000 }, adminId);
    expect(user.credit_limit).toBe(5000);
  });

  it('defaults credit_limit to null when omitted', () => {
    const user = createUser({ name: 'NoCredit' }, adminId);
    expect(user.credit_limit).toBeNull();
  });

  it('persists credit_limit = -1 (explicit unlimited)', () => {
    const user = createUser({ name: 'Unlim', credit_limit: -1 }, adminId);
    expect(user.credit_limit).toBe(-1);
  });
});

// ── listUsers ───────────────────────────────────────

describe('listUsers', () => {
  it('returns empty array when no users', () => {
    expect(listUsers()).toEqual([]);
  });

  it('returns all users', () => {
    createUser({ name: 'First' }, adminId);
    createUser({ name: 'Second' }, adminId);

    const users = listUsers();
    expect(users).toHaveLength(2);
    const names = users.map((u) => u.name);
    expect(names).toContain('First');
    expect(names).toContain('Second');
  });
});

// ── getUserById ─────────────────────────────────────

describe('getUserById', () => {
  it('returns user when found', () => {
    const created = createUser({ name: 'Dave' }, adminId);
    const found = getUserById(created.id);

    expect(found).toBeDefined();
    expect(found!.id).toBe(created.id);
    expect(found!.name).toBe('Dave');
  });

  it('returns undefined for unknown ID', () => {
    expect(getUserById('nonexistent')).toBeUndefined();
  });
});

// ── updateUser ──────────────────────────────────────

describe('updateUser', () => {
  it('updates name', () => {
    const user = createUser({ name: 'Eve' }, adminId);
    const updated = updateUser(user.id, { name: 'Eve Updated' });

    expect(updated).toBeDefined();
    expect(updated!.name).toBe('Eve Updated');
  });

  it('updates email', () => {
    const user = createUser({ name: 'Frank', email: 'old@example.com' }, adminId);
    const updated = updateUser(user.id, { email: 'new@example.com' });

    expect(updated!.email).toBe('new@example.com');
  });

  it('updates enabled flag', () => {
    const user = createUser({ name: 'Grace' }, adminId);
    expect(user.enabled).toBe(1);

    const updated = updateUser(user.id, { enabled: false });
    expect(updated!.enabled).toBe(0);

    const reEnabled = updateUser(user.id, { enabled: true });
    expect(reEnabled!.enabled).toBe(1);
  });

  it('updates multiple fields at once', () => {
    const user = createUser({ name: 'Hank' }, adminId);
    const updated = updateUser(user.id, { name: 'Hank Jr', email: 'hank@test.com', enabled: false });

    expect(updated!.name).toBe('Hank Jr');
    expect(updated!.email).toBe('hank@test.com');
    expect(updated!.enabled).toBe(0);
  });

  it('returns existing user when no fields provided', () => {
    const user = createUser({ name: 'Ivy' }, adminId);
    const same = updateUser(user.id, {});

    expect(same).toBeDefined();
    expect(same!.name).toBe('Ivy');
  });

  it('returns undefined for unknown ID', () => {
    expect(updateUser('nonexistent', { name: 'Ghost' })).toBeUndefined();
  });

  it('updates credit_limit to a value, to null, and to -1 independently', () => {
    const user = createUser({ name: 'Flex' }, adminId);
    expect(user.credit_limit).toBeNull();

    const set = updateUser(user.id, { credit_limit: 5000 });
    expect(set!.credit_limit).toBe(5000);

    const cleared = updateUser(user.id, { credit_limit: null });
    expect(cleared!.credit_limit).toBeNull();

    const unlim = updateUser(user.id, { credit_limit: -1 });
    expect(unlim!.credit_limit).toBe(-1);
  });

  it('updating daily_token_quota does not touch credit_limit and vice versa', () => {
    const user = createUser(
      { name: 'Indep', daily_token_quota: 100, credit_limit: 200 },
      adminId,
    );

    const q = updateUser(user.id, { daily_token_quota: 999 });
    expect(q!.daily_token_quota).toBe(999);
    expect(q!.credit_limit).toBe(200);

    const c = updateUser(user.id, { credit_limit: 888 });
    expect(c!.daily_token_quota).toBe(999);
    expect(c!.credit_limit).toBe(888);
  });
});

// ── deleteUser ──────────────────────────────────────

describe('deleteUser', () => {
  it('deletes an existing user', () => {
    const user = createUser({ name: 'Jack' }, adminId);
    expect(deleteUser(user.id)).toBe(true);
    expect(getUserById(user.id)).toBeUndefined();
  });

  it('returns false for unknown ID', () => {
    expect(deleteUser('nonexistent')).toBe(false);
  });

  it('cascades to api_tokens on delete', () => {
    const user = createUser({ name: 'Kate' }, adminId);

    // Insert a token directly
    db.prepare(
      `INSERT INTO api_tokens (user_id, name, token_hash, token_encrypted, token_iv, token_auth_tag, token_prefix)
       VALUES (?, 'test', 'hash1', 'enc', 'iv', 'tag', 'cp_live_...')`,
    ).run(user.id);

    const tokensBefore = db.prepare('SELECT COUNT(*) as count FROM api_tokens WHERE user_id = ?').get(user.id) as { count: number };
    expect(tokensBefore.count).toBe(1);

    deleteUser(user.id);

    const tokensAfter = db.prepare('SELECT COUNT(*) as count FROM api_tokens WHERE user_id = ?').get(user.id) as { count: number };
    expect(tokensAfter.count).toBe(0);
  });
});
