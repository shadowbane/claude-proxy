import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { createTestDb } from './helpers.js';
import { backfillEstimatedCredits } from '../src/server/db/backfill.js';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
});

afterEach(() => {
  db.close();
});

function insertLog(
  model: string,
  prompt: number,
  completion: number,
  cacheCreation: number,
  cacheRead: number,
  estimatedCredits: number | null = null,
) {
  return db
    .prepare(
      `INSERT INTO request_logs
         (model, endpoint, prompt_tokens, completion_tokens,
          cache_creation_input_tokens, cache_read_input_tokens, estimated_credits, status)
       VALUES (?, '/v1/messages', ?, ?, ?, ?, ?, 'success')
       RETURNING id`,
    )
    .get(model, prompt, completion, cacheCreation, cacheRead, estimatedCredits) as { id: number };
}

function getCredits(id: number): number | null {
  const row = db
    .prepare('SELECT estimated_credits FROM request_logs WHERE id = ?')
    .get(id) as { estimated_credits: number | null };
  return row.estimated_credits;
}

describe('backfillEstimatedCredits', () => {
  it('updates historical mimo-v2-pro rows with NULL credits', () => {
    const a = insertLog('mimo-v2-pro', 100, 50, 25, 1000, null);
    const b = insertLog('mimo-v2-pro', 200, 100, 0, 500, null);

    const receipt = backfillEstimatedCredits(db);

    expect(receipt).not.toBeNull();
    expect(receipt?.rows_updated).toBe(2);
    expect(getCredits(a.id)).toBe((100 + 50 + 25 + 1000) * 2);
    expect(getCredits(b.id)).toBe((200 + 100 + 0 + 500) * 2);
  });

  it('does not touch non-mimo-v2-pro rows', () => {
    const pro = insertLog('mimo-v2-pro', 100, 50, 0, 0, null);
    const other = insertLog('claude-3-5-sonnet', 100, 50, 0, 0, null);

    backfillEstimatedCredits(db);

    expect(getCredits(pro.id)).toBe(300);
    expect(getCredits(other.id)).toBeNull();
  });

  it('does not overwrite rows that already have estimated_credits set', () => {
    const preset = insertLog('mimo-v2-pro', 100, 50, 0, 0, 99999);

    backfillEstimatedCredits(db);

    expect(getCredits(preset.id)).toBe(99999);
  });

  it('persists a flag and is a no-op on subsequent calls', () => {
    insertLog('mimo-v2-pro', 100, 50, 0, 0, null);

    const first = backfillEstimatedCredits(db);
    expect(first).not.toBeNull();
    expect(first?.rows_updated).toBe(1);

    // New rows inserted after the first backfill should NOT be touched
    // on the second call, because the flag is set.
    const later = insertLog('mimo-v2-pro', 999, 0, 0, 0, null);

    const second = backfillEstimatedCredits(db);
    expect(second).toBeNull();

    expect(getCredits(later.id)).toBeNull();
  });

  it('records a receipt in the settings table', () => {
    insertLog('mimo-v2-pro', 100, 50, 0, 0, null);

    backfillEstimatedCredits(db);

    const row = db
      .prepare("SELECT value FROM settings WHERE key = 'backfill_estimated_credits_v1'")
      .get() as { value: string } | undefined;
    expect(row).toBeDefined();
    const receipt = JSON.parse(row!.value) as { ran_at: string; rows_updated: number };
    expect(receipt.rows_updated).toBe(1);
    expect(typeof receipt.ran_at).toBe('string');
  });

  it('is a no-op when there are no rows to backfill', () => {
    const receipt = backfillEstimatedCredits(db);
    expect(receipt?.rows_updated).toBe(0);

    // Flag should still be set so we don't keep scanning on every startup
    const second = backfillEstimatedCredits(db);
    expect(second).toBeNull();
  });
});
