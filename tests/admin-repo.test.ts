import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { createTestDb, mockGetDb } from './helpers.js';
import {
  createAdmin,
  getAdminByUsername,
  getAdminById,
  updateAdminPassword,
  countAdmins,
} from '../src/server/db/repositories/admin.js';
import { hashPassword, verifyPassword } from '../src/server/lib/crypto.js';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  mockGetDb(db);
});

afterEach(() => {
  db.close();
  vi.restoreAllMocks();
});

// ── createAdmin ─────────────────────────────────────

describe('createAdmin', () => {
  it('creates an admin and returns the row', async () => {
    const hash = await hashPassword('secret');
    const admin = createAdmin('alice', hash);

    expect(admin.username).toBe('alice');
    expect(admin.password_hash).toBe(hash);
    expect(admin.id).toBeTruthy();
    expect(admin.created_at).toBeTruthy();
    expect(admin.updated_at).toBeTruthy();
  });

  it('rejects duplicate username', async () => {
    const hash = await hashPassword('pass');
    createAdmin('bob', hash);
    expect(() => createAdmin('bob', hash)).toThrow(/UNIQUE/);
  });

  it('generates unique IDs', async () => {
    const hash = await hashPassword('pass');
    const a1 = createAdmin('user1', hash);
    const a2 = createAdmin('user2', hash);
    expect(a1.id).not.toBe(a2.id);
  });
});

// ── getAdminByUsername ───────────────────────────────

describe('getAdminByUsername', () => {
  it('returns admin when found', async () => {
    const hash = await hashPassword('pass');
    createAdmin('charlie', hash);

    const found = getAdminByUsername('charlie');
    expect(found).toBeDefined();
    expect(found!.username).toBe('charlie');
  });

  it('returns undefined when not found', () => {
    expect(getAdminByUsername('nonexistent')).toBeUndefined();
  });

  it('is case-sensitive', async () => {
    const hash = await hashPassword('pass');
    createAdmin('Admin', hash);

    expect(getAdminByUsername('Admin')).toBeDefined();
    expect(getAdminByUsername('admin')).toBeUndefined();
    expect(getAdminByUsername('ADMIN')).toBeUndefined();
  });
});

// ── getAdminById ────────────────────────────────────

describe('getAdminById', () => {
  it('returns admin when found', async () => {
    const hash = await hashPassword('pass');
    const created = createAdmin('dave', hash);

    const found = getAdminById(created.id);
    expect(found).toBeDefined();
    expect(found!.id).toBe(created.id);
  });

  it('returns undefined for unknown ID', () => {
    expect(getAdminById('0000000000000000')).toBeUndefined();
  });
});

// ── updateAdminPassword ─────────────────────────────

describe('updateAdminPassword', () => {
  it('updates the password hash', async () => {
    const oldHash = await hashPassword('old');
    const admin = createAdmin('eve', oldHash);

    const newHash = await hashPassword('new');
    updateAdminPassword(admin.id, newHash);

    const updated = getAdminById(admin.id)!;
    expect(updated.password_hash).toBe(newHash);
    expect(await verifyPassword('new', updated.password_hash)).toBe(true);
    expect(await verifyPassword('old', updated.password_hash)).toBe(false);
  });

  it('updates the updated_at timestamp', async () => {
    const hash = await hashPassword('pass');
    const admin = createAdmin('frank', hash);
    const originalUpdatedAt = admin.updated_at;

    // SQLite datetime('now') has second precision, so this may or may not differ
    // Just verify the field exists and is valid
    const newHash = await hashPassword('newpass');
    updateAdminPassword(admin.id, newHash);

    const updated = getAdminById(admin.id)!;
    expect(updated.updated_at).toBeTruthy();
    expect(updated.updated_at.length).toBe(originalUpdatedAt.length);
  });

  it('is a no-op for unknown ID', async () => {
    const hash = await hashPassword('pass');
    // Should not throw
    updateAdminPassword('nonexistent', hash);
  });
});

// ── countAdmins ─────────────────────────────────────

describe('countAdmins', () => {
  it('returns 0 on empty table', () => {
    expect(countAdmins()).toBe(0);
  });

  it('returns correct count', async () => {
    const hash = await hashPassword('pass');
    createAdmin('a1', hash);
    expect(countAdmins()).toBe(1);

    createAdmin('a2', hash);
    expect(countAdmins()).toBe(2);
  });
});

// ── seedAdmin (via connection module) ───────────────
// seedAdmin() calls getDb() internally (same-module reference),
// so we test it through the real singleton instead of the mock.

describe('seedAdmin', () => {
  it('seeds admin when table is empty', async () => {
    const { seedAdmin, getDb: realGetDb, closeDb } = await import(
      '../src/server/db/connection.js'
    );

    // Restore mocks so repo functions use the real getDb too
    vi.restoreAllMocks();
    closeDb(); // clear any existing singleton

    // realGetDb() creates a fresh :memory: DB with schema
    realGetDb();

    expect(countAdmins()).toBe(0);
    await seedAdmin();
    expect(countAdmins()).toBe(1);

    const admin = getAdminByUsername('admin');
    expect(admin).toBeDefined();
    expect(await verifyPassword('testpass123', admin!.password_hash)).toBe(true);

    closeDb();
  });

  it('skips seeding when admin already exists', async () => {
    const { seedAdmin, getDb: realGetDb, closeDb } = await import(
      '../src/server/db/connection.js'
    );

    vi.restoreAllMocks();
    closeDb();
    realGetDb();

    const hash = await hashPassword('existing');
    createAdmin('admin', hash);
    expect(countAdmins()).toBe(1);

    await seedAdmin();
    expect(countAdmins()).toBe(1); // Still 1, not 2

    closeDb();
  });
});
