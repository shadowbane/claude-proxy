// Settings repository — key-value store for application configuration
import type { Setting } from '../../../shared/types.js';
import { getDb } from '../connection.js';
import { encryptToken, decryptToken } from '../../lib/crypto.js';

export function getAll(): Record<string, string> {
  const db = getDb();
  const rows = db.prepare('SELECT key, value FROM settings').all() as Pick<Setting, 'key' | 'value'>[];
  const result: Record<string, string> = {};
  for (const row of rows) {
    result[row.key] = row.value;
  }
  return result;
}

export function get(key: string): string | undefined {
  const db = getDb();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value;
}

export function upsert(key: string, value: string): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO settings (key, value, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
  `).run(key, value);
}

export function remove(key: string): void {
  const db = getDb();
  db.prepare('DELETE FROM settings WHERE key = ?').run(key);
}

// ── Encrypted settings helpers ──────────────────

export function getDecrypted(key: string, encryptionKey: string): string | undefined {
  const raw = get(key);
  if (!raw) return undefined;
  try {
    const { encrypted, iv, authTag } = JSON.parse(raw) as { encrypted: string; iv: string; authTag: string };
    return decryptToken(encrypted, iv, authTag, encryptionKey);
  } catch {
    return undefined;
  }
}

export function upsertEncrypted(key: string, plainValue: string, encryptionKey: string): void {
  const { encrypted, iv, authTag } = encryptToken(plainValue, encryptionKey);
  upsert(key, JSON.stringify({ encrypted, iv, authTag }));
}
