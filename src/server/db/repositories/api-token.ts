// API Token repository — CRUD for user API tokens
import { getDb } from '../connection.js';
import { generateApiToken, hashToken, encryptToken, decryptToken } from '../../lib/crypto.js';
import { config } from '../../config.js';
import type { ApiToken, ApiTokenMasked } from '../../../shared/types.js';

const MASKED_COLUMNS = 'id, user_id, name, token_prefix, enabled, last_used_at, created_at';

/**
 * Create a new API token for a user.
 * Returns the raw token (show once) plus the masked DB row.
 */
export function createApiToken(
  userId: string,
  name: string,
): { raw: string; token: ApiTokenMasked } {
  const raw = generateApiToken();
  const hash = hashToken(raw);
  const { encrypted, iv, authTag } = encryptToken(raw, config.tokenEncryptionKey);
  const prefix = raw.slice(0, 12) + '...';

  const row = getDb()
    .prepare(
      `INSERT INTO api_tokens (user_id, name, token_hash, token_encrypted, token_iv, token_auth_tag, token_prefix)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       RETURNING ${MASKED_COLUMNS}`,
    )
    .get(userId, name, hash, encrypted, iv, authTag, prefix) as ApiTokenMasked;

  return { raw, token: row };
}

/**
 * Find a token by its SHA-256 hash. Used for proxy auth.
 * JOINs to users to check both token and user are enabled.
 */
export function findByHash(
  hash: string,
): (ApiToken & { user_name: string; user_enabled: number }) | undefined {
  return getDb()
    .prepare(
      `SELECT t.*, u.name AS user_name, u.enabled AS user_enabled
       FROM api_tokens t
       JOIN users u ON u.id = t.user_id
       WHERE t.token_hash = ?`,
    )
    .get(hash) as (ApiToken & { user_name: string; user_enabled: number }) | undefined;
}

/**
 * List all tokens for a user (masked — no encryption fields).
 */
export function listByUser(userId: string): ApiTokenMasked[] {
  return getDb()
    .prepare(`SELECT ${MASKED_COLUMNS} FROM api_tokens WHERE user_id = ? ORDER BY created_at DESC`)
    .all(userId) as ApiTokenMasked[];
}

/**
 * Revoke (delete) a token by ID.
 */
export function revokeToken(tokenId: string): boolean {
  const result = getDb().prepare('DELETE FROM api_tokens WHERE id = ?').run(tokenId);
  return result.changes > 0;
}

/**
 * Update token fields (name, enabled).
 */
export function updateToken(
  tokenId: string,
  fields: { name?: string; enabled?: boolean },
): ApiTokenMasked | undefined {
  const sets: string[] = [];
  const values: unknown[] = [];

  if (fields.name !== undefined) {
    sets.push('name = ?');
    values.push(fields.name);
  }
  if (fields.enabled !== undefined) {
    sets.push('enabled = ?');
    values.push(fields.enabled ? 1 : 0);
  }

  if (sets.length === 0) {
    return getDb()
      .prepare(`SELECT ${MASKED_COLUMNS} FROM api_tokens WHERE id = ?`)
      .get(tokenId) as ApiTokenMasked | undefined;
  }

  values.push(tokenId);

  return getDb()
    .prepare(`UPDATE api_tokens SET ${sets.join(', ')} WHERE id = ? RETURNING ${MASKED_COLUMNS}`)
    .get(...values) as ApiTokenMasked | undefined;
}

/**
 * Decrypt and return the raw token. Admin-only operation.
 */
export function revealToken(tokenId: string): string | undefined {
  const row = getDb()
    .prepare('SELECT token_encrypted, token_iv, token_auth_tag FROM api_tokens WHERE id = ?')
    .get(tokenId) as Pick<ApiToken, 'token_encrypted' | 'token_iv' | 'token_auth_tag'> | undefined;

  if (!row) return undefined;

  return decryptToken(row.token_encrypted, row.token_iv, row.token_auth_tag, config.tokenEncryptionKey);
}

/**
 * Update last_used_at timestamp. Debounced — collects token IDs and flushes
 * a single batched UPDATE every 30 seconds to avoid a write per request.
 */
const FLUSH_INTERVAL_MS = 30_000;
const pendingTouches = new Set<string>();
let flushTimer: ReturnType<typeof setInterval> | null = null;

function flushTouches(): void {
  if (pendingTouches.size === 0) return;
  const ids = [...pendingTouches];
  pendingTouches.clear();

  const db = getDb();
  const placeholders = ids.map(() => '?').join(', ');
  db.prepare(
    `UPDATE api_tokens SET last_used_at = datetime('now') WHERE id IN (${placeholders})`,
  ).run(...ids);
}

export function touchLastUsed(tokenId: string): void {
  pendingTouches.add(tokenId);

  if (!flushTimer) {
    flushTimer = setInterval(flushTouches, FLUSH_INTERVAL_MS);
    // Allow the process to exit without waiting for the timer
    if (flushTimer && typeof flushTimer === 'object' && 'unref' in flushTimer) {
      flushTimer.unref();
    }
  }
}

/** Flush any pending touchLastUsed writes (call on shutdown). */
export function flushPendingTouches(): void {
  flushTouches();
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
}
