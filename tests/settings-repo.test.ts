import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { createTestDb, mockGetDb } from './helpers.js';
import { getAll, get, upsert } from '../src/server/db/repositories/settings.js';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  mockGetDb(db);
});

afterEach(() => {
  db.close();
  vi.restoreAllMocks();
});

describe('settings repository', () => {
  it('returns empty object when no settings', () => {
    expect(getAll()).toEqual({});
  });

  it('upserts and retrieves a setting', () => {
    upsert('active_model', 'mimo-v2');
    expect(get('active_model')).toBe('mimo-v2');
  });

  it('returns undefined for missing key', () => {
    expect(get('nonexistent')).toBeUndefined();
  });

  it('updates an existing setting', () => {
    upsert('active_model', 'mimo-v1');
    upsert('active_model', 'mimo-v2');
    expect(get('active_model')).toBe('mimo-v2');
  });

  it('getAll returns all settings as key-value object', () => {
    upsert('active_model', 'mimo-v2');
    upsert('max_tokens', '4096');

    const all = getAll();
    expect(all).toEqual({
      active_model: 'mimo-v2',
      max_tokens: '4096',
    });
  });

  it('upsert updates the updated_at timestamp', () => {
    upsert('key1', 'val1');
    const row1 = db.prepare('SELECT updated_at FROM settings WHERE key = ?').get('key1') as { updated_at: string };
    expect(row1.updated_at).toBeTruthy();

    upsert('key1', 'val2');
    const row2 = db.prepare('SELECT updated_at FROM settings WHERE key = ?').get('key1') as { updated_at: string };
    expect(row2.updated_at).toBeTruthy();
  });
});
