// One-shot backfills guarded by the `settings` table.
// Each backfill uses a unique flag key; once the flag is set it never runs again.

import type Database from 'better-sqlite3';

interface BackfillReceipt {
  ran_at: string;
  rows_updated: number;
}

/**
 * Backfills `estimated_credits` for historical `mimo-v2-pro` rows that were
 * inserted before the column existed. Runs once per DB, then sets a flag in
 * the settings table so it will not run again.
 *
 * Safe to call on every startup — the flag guard and the `IS NULL` guard in
 * the UPDATE both prevent double application.
 */
export function backfillEstimatedCredits(db: Database.Database): BackfillReceipt | null {
  const FLAG = 'backfill_estimated_credits_v1';

  const existing = db
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(FLAG) as { value: string } | undefined;
  if (existing) return null;

  const result = db
    .prepare(
      `UPDATE request_logs
       SET estimated_credits =
         (prompt_tokens + completion_tokens + cache_creation_input_tokens + cache_read_input_tokens) * 2
       WHERE model = 'mimo-v2-pro'
         AND estimated_credits IS NULL`,
    )
    .run();

  const receipt: BackfillReceipt = {
    ran_at: new Date().toISOString(),
    rows_updated: Number(result.changes),
  };

  db.prepare(
    `INSERT INTO settings (key, value, updated_at)
     VALUES (?, ?, datetime('now'))`,
  ).run(FLAG, JSON.stringify(receipt));

  return receipt;
}
