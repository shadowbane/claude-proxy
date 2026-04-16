import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { createTestDb, mockGetDb } from './helpers.js';
import {
  create,
  getStats,
  getUsageByUser,
  getTimeSeries,
  getPaginated,
} from '../src/server/db/repositories/request-log.js';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  mockGetDb(db);
});

afterEach(() => {
  db.close();
  vi.restoreAllMocks();
});

function seedUser(name = 'Test User'): string {
  const row = db.prepare("INSERT INTO users (name) VALUES (?) RETURNING id").get(name) as { id: string };
  return row.id;
}

function seedLog(overrides: Partial<{
  user_id: string | null;
  token_id: string | null;
  model: string;
  endpoint: string;
  prompt_tokens: number;
  completion_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  latency_ms: number;
  status: string;
  error_message: string | null;
  client_ip: string | null;
}> = {}) {
  return create({
    user_id: overrides.user_id ?? null,
    token_id: overrides.token_id ?? null,
    model: overrides.model ?? 'test-model',
    endpoint: overrides.endpoint ?? '/v1/messages',
    prompt_tokens: overrides.prompt_tokens ?? 0,
    completion_tokens: overrides.completion_tokens ?? 0,
    cache_creation_input_tokens: overrides.cache_creation_input_tokens ?? 0,
    cache_read_input_tokens: overrides.cache_read_input_tokens ?? 0,
    latency_ms: overrides.latency_ms ?? 100,
    status: overrides.status ?? 'success',
    error_message: overrides.error_message ?? null,
    client_ip: overrides.client_ip ?? '127.0.0.1',
  });
}

// ── create ──────────────────────────────────────────

describe('create', () => {
  it('inserts a request log and returns it with id', () => {
    const log = seedLog({ model: 'mimo-v2', latency_ms: 250 });
    expect(log.id).toBeGreaterThan(0);
    expect(log.model).toBe('mimo-v2');
    expect(log.latency_ms).toBe(250);
    expect(log.status).toBe('success');
    expect(log.created_at).toBeTruthy();
  });

  it('stores user_id and token_id', () => {
    const userId = seedUser();
    // token_id FK is nullable / SET NULL on delete, but we need a valid FK or null
    const log = seedLog({ user_id: userId });
    expect(log.user_id).toBe(userId);
    expect(log.token_id).toBeNull();
  });
});

// ── getStats ────────────────────────────────────────

describe('getStats', () => {
  it('returns zeroed stats when no logs exist', () => {
    const stats = getStats();
    expect(stats.total).toBe(0);
    expect(stats.success).toBe(0);
    expect(stats.errors).toBe(0);
    expect(stats.totalTokens).toBe(0);
  });

  it('aggregates stats across logs', () => {
    seedLog({ prompt_tokens: 100, completion_tokens: 50, status: 'success', latency_ms: 200 });
    seedLog({ prompt_tokens: 200, completion_tokens: 100, status: 'success', latency_ms: 400 });
    seedLog({ status: 'error', error_message: 'fail', latency_ms: 50 });

    const stats = getStats();
    expect(stats.total).toBe(3);
    expect(stats.success).toBe(2);
    expect(stats.errors).toBe(1);
    expect(stats.promptTokens).toBe(300);
    expect(stats.completionTokens).toBe(150);
    expect(stats.totalTokens).toBe(450);
    expect(stats.avgLatencyMs).toBeCloseTo(216.67, 0);
  });

  it('filters by date range', () => {
    seedLog({ prompt_tokens: 100 });

    // Far future range — should exclude our log
    const stats = getStats('2099-01-01', '2099-12-31');
    expect(stats.total).toBe(0);
  });
});

// ── getUsageByUser ──────────────────────────────────

describe('getUsageByUser', () => {
  it('returns per-user usage summary', () => {
    const userId1 = seedUser('Alice');
    const userId2 = seedUser('Bob');

    seedLog({ user_id: userId1, prompt_tokens: 100, completion_tokens: 50 });
    seedLog({ user_id: userId1, prompt_tokens: 200, completion_tokens: 100 });
    seedLog({ user_id: userId2, prompt_tokens: 50, completion_tokens: 25 });

    const usage = getUsageByUser();
    expect(usage).toHaveLength(2);

    // Sorted by total tokens descending
    expect(usage[0].user_name).toBe('Alice');
    expect(usage[0].total_requests).toBe(2);
    expect(usage[0].prompt_tokens).toBe(300);
    expect(usage[0].completion_tokens).toBe(150);
    expect(usage[0].total_tokens).toBe(450);

    expect(usage[1].user_name).toBe('Bob');
    expect(usage[1].total_requests).toBe(1);
    expect(usage[1].total_tokens).toBe(75);
  });

  it('returns empty array when no logs', () => {
    expect(getUsageByUser()).toEqual([]);
  });
});

// ── getTimeSeries ───────────────────────────────────

describe('getTimeSeries', () => {
  it('returns bucketed time series data', () => {
    seedLog({ prompt_tokens: 100, completion_tokens: 50 });
    seedLog({ prompt_tokens: 200, completion_tokens: 100 });

    // Use a wide range to capture our logs
    const series = getTimeSeries('2000-01-01', '2099-12-31', 0, 'day');
    expect(series.length).toBeGreaterThanOrEqual(1);
    expect(series[0].requests).toBe(2);
    expect(series[0].prompt_tokens).toBe(300);
    expect(series[0].total_tokens).toBe(450);
  });

  it('filters by userId', () => {
    const userId = seedUser('Alice');
    seedLog({ user_id: userId, prompt_tokens: 100 });
    seedLog({ prompt_tokens: 999 }); // no user_id

    const series = getTimeSeries('2000-01-01', '2099-12-31', 0, 'day', userId);
    expect(series.length).toBeGreaterThanOrEqual(1);
    expect(series[0].prompt_tokens).toBe(100);
  });

  it('only includes successful requests', () => {
    seedLog({ prompt_tokens: 100, status: 'success' });
    seedLog({ prompt_tokens: 999, status: 'error' });

    const series = getTimeSeries('2000-01-01', '2099-12-31', 0, 'day');
    expect(series[0].prompt_tokens).toBe(100);
  });
});

// ── getPaginated ────────────────────────────────────

describe('getPaginated', () => {
  it('returns paginated results with total count', () => {
    for (let i = 0; i < 5; i++) seedLog();

    const page1 = getPaginated(2, 0);
    expect(page1.rows).toHaveLength(2);
    expect(page1.total).toBe(5);

    const page2 = getPaginated(2, 2);
    expect(page2.rows).toHaveLength(2);
    expect(page2.total).toBe(5);
  });

  it('filters by userId', () => {
    const userId = seedUser();
    seedLog({ user_id: userId });
    seedLog(); // no user_id
    seedLog(); // no user_id

    const result = getPaginated(50, 0, { userId });
    expect(result.rows).toHaveLength(1);
    expect(result.total).toBe(1);
  });

  it('filters by status', () => {
    seedLog({ status: 'success' });
    seedLog({ status: 'success' });
    seedLog({ status: 'error' });

    const result = getPaginated(50, 0, { status: 'error' });
    expect(result.rows).toHaveLength(1);
    expect(result.total).toBe(1);
  });

  it('returns empty when no logs match', () => {
    const result = getPaginated(50, 0, { userId: 'nonexistent' });
    expect(result.rows).toEqual([]);
    expect(result.total).toBe(0);
  });
});
