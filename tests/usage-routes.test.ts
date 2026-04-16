import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { createTestDb, seedTestAdmin, buildTestApp, loginAs } from './helpers.js';
import { create as createLog } from '../src/server/db/repositories/request-log.js';
import type { FastifyInstance } from 'fastify';

let db: Database.Database;
let app: FastifyInstance;
let cookie: string;

function seedUser(name: string): string {
  const row = db.prepare("INSERT INTO users (name) VALUES (?) RETURNING id").get(name) as { id: string };
  return row.id;
}

function seedLog(overrides: Record<string, unknown> = {}) {
  return createLog({
    user_id: (overrides.user_id as string) ?? null,
    token_id: (overrides.token_id as string) ?? null,
    model: (overrides.model as string) ?? 'test-model',
    endpoint: (overrides.endpoint as string) ?? '/v1/messages',
    prompt_tokens: (overrides.prompt_tokens as number) ?? 0,
    completion_tokens: (overrides.completion_tokens as number) ?? 0,
    cache_creation_input_tokens: (overrides.cache_creation_input_tokens as number) ?? 0,
    cache_read_input_tokens: (overrides.cache_read_input_tokens as number) ?? 0,
    latency_ms: (overrides.latency_ms as number) ?? 100,
    status: (overrides.status as string) ?? 'success',
    error_message: (overrides.error_message as string) ?? null,
    client_ip: (overrides.client_ip as string) ?? '127.0.0.1',
  });
}

beforeEach(async () => {
  db = createTestDb();
  await seedTestAdmin(db);
  app = await buildTestApp(db);
  cookie = await loginAs(app, 'admin', 'testpass123');
});

afterEach(async () => {
  await app.close();
  db.close();
  vi.restoreAllMocks();
});

// ── GET /api/usage/stats ────────────────────────────

describe('GET /api/usage/stats', () => {
  it('returns aggregated stats', async () => {
    seedLog({ prompt_tokens: 100, completion_tokens: 50, status: 'success' });
    seedLog({ prompt_tokens: 200, completion_tokens: 100, status: 'success' });
    seedLog({ status: 'error', error_message: 'fail' });

    const res = await app.inject({
      method: 'GET',
      url: '/api/usage/stats',
      headers: { cookie },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(3);
    expect(body.success).toBe(2);
    expect(body.errors).toBe(1);
    expect(body.promptTokens).toBe(300);
    expect(body.completionTokens).toBe(150);
    expect(body.totalTokens).toBe(450);
  });

  it('requires admin auth', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/usage/stats',
    });
    expect(res.statusCode).toBe(401);
  });

  it('filters by date range', async () => {
    seedLog({ prompt_tokens: 100 });

    const res = await app.inject({
      method: 'GET',
      url: '/api/usage/stats?start=2099-01-01&end=2099-12-31',
      headers: { cookie },
    });

    expect(res.json().total).toBe(0);
  });
});

// ── GET /api/usage/by-user ──────────────────────────

describe('GET /api/usage/by-user', () => {
  it('returns per-user usage breakdown', async () => {
    const userId1 = seedUser('Alice');
    const userId2 = seedUser('Bob');

    seedLog({ user_id: userId1, prompt_tokens: 100, completion_tokens: 50 });
    seedLog({ user_id: userId1, prompt_tokens: 200, completion_tokens: 100 });
    seedLog({ user_id: userId2, prompt_tokens: 50, completion_tokens: 25 });

    const res = await app.inject({
      method: 'GET',
      url: '/api/usage/by-user',
      headers: { cookie },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(2);
    expect(body[0].user_name).toBe('Alice');
    expect(body[0].total_tokens).toBe(450);
    expect(body[1].user_name).toBe('Bob');
    expect(body[1].total_tokens).toBe(75);
  });

  it('requires admin auth', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/usage/by-user',
    });
    expect(res.statusCode).toBe(401);
  });
});

// ── GET /api/usage/timeseries ───────────────────────

describe('GET /api/usage/timeseries', () => {
  it('returns bucketed time series', async () => {
    seedLog({ prompt_tokens: 100, completion_tokens: 50 });

    const res = await app.inject({
      method: 'GET',
      url: '/api/usage/timeseries?start=2000-01-01&end=2099-12-31&bucket=day',
      headers: { cookie },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.length).toBeGreaterThanOrEqual(1);
    expect(body[0].prompt_tokens).toBe(100);
  });

  it('returns 400 when start/end missing', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/usage/timeseries',
      headers: { cookie },
    });

    expect(res.statusCode).toBe(400);
  });
});

// ── GET /api/usage/by-user/:id/timeseries ───────────

describe('GET /api/usage/by-user/:id/timeseries', () => {
  it('returns per-user time series', async () => {
    const userId = seedUser('Alice');
    seedLog({ user_id: userId, prompt_tokens: 100, completion_tokens: 50 });
    seedLog({ prompt_tokens: 999 }); // different user

    const res = await app.inject({
      method: 'GET',
      url: `/api/usage/by-user/${userId}/timeseries?start=2000-01-01&end=2099-12-31&bucket=day`,
      headers: { cookie },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.length).toBeGreaterThanOrEqual(1);
    expect(body[0].prompt_tokens).toBe(100);
  });

  it('returns 400 when start/end missing', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/usage/by-user/someid/timeseries',
      headers: { cookie },
    });

    expect(res.statusCode).toBe(400);
  });
});
