// SQLite singleton connection
import Database from 'better-sqlite3';
import { config } from '../config.js';
import { SCHEMA_SQL } from './schema.js';
import { backfillEstimatedCredits, backfillMultiModelCredits } from './backfill.js';
import { hashPassword } from '../lib/crypto.js';
import { mkdirSync } from 'fs';
import { dirname } from 'path';

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  mkdirSync(dirname(config.dbPath), { recursive: true });

  _db = new Database(config.dbPath);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  _db.pragma('synchronous = NORMAL');
  _db.pragma('busy_timeout = 5000');
  _db.pragma('cache_size = -20000');
  _db.pragma('temp_store = MEMORY');
  _db.pragma('mmap_size = 268435456');

  _db.exec(SCHEMA_SQL);

  // Column migrations for existing databases
  try { _db.exec('ALTER TABLE users ADD COLUMN daily_token_quota INTEGER DEFAULT NULL'); } catch { /* column already exists */ }
  try { _db.exec('ALTER TABLE users ADD COLUMN credit_limit INTEGER DEFAULT NULL'); } catch { /* column already exists */ }
  try { _db.exec('ALTER TABLE request_logs ADD COLUMN estimated_credits INTEGER DEFAULT NULL'); } catch { /* column already exists */ }

  // One-shot data backfills (guarded by settings flags so they run exactly once)
  backfillEstimatedCredits(_db);
  backfillMultiModelCredits(_db);

  return _db;
}

/**
 * Seed the default admin account if no admins exist.
 * Must be called after getDb() since it uses the connection.
 */
export async function seedAdmin(): Promise<void> {
  const db = getDb();
  const row = db.prepare('SELECT COUNT(*) as count FROM admins').get() as { count: number };
  if (row.count > 0) return;

  const hash = await hashPassword(config.adminPassword);
  db.prepare('INSERT INTO admins (username, password_hash) VALUES (?, ?)').run(
    config.adminUsername,
    hash,
  );
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
