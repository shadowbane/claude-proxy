import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { createTestDb, seedTestAdmin, buildTestApp, loginAs } from './helpers.js';
import { create as createLog } from '../src/server/db/repositories/request-log.js';
import type { FastifyInstance } from 'fastify';

let db: Database.Database;
let app: FastifyInstance;
let cookie: string;

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

// ── GET /api/logs ───────────────────────────────────

describe('GET /api/logs', () => {
  it('returns paginated logs', async () => {
    for (let i = 0; i < 5; i++) seedLog();

    const res = await app.inject({
      method: 'GET',
      url: '/api/logs?limit=2&offset=0',
      headers: { cookie },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.rows).toHaveLength(2);
    expect(body.total).toBe(5);
  });

  it('defaults to limit=50 offset=0', async () => {
    for (let i = 0; i < 3; i++) seedLog();

    const res = await app.inject({
      method: 'GET',
      url: '/api/logs',
      headers: { cookie },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().rows).toHaveLength(3);
  });

  it('caps limit at 200', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/logs?limit=999',
      headers: { cookie },
    });

    // It should not error; it caps to 200
    expect(res.statusCode).toBe(200);
  });

  it('filters by user_id', async () => {
    const userId = db.prepare("INSERT INTO users (name) VALUES ('Test') RETURNING id").get() as { id: string };
    seedLog({ user_id: userId.id });
    seedLog();
    seedLog();

    const res = await app.inject({
      method: 'GET',
      url: `/api/logs?user_id=${userId.id}`,
      headers: { cookie },
    });

    expect(res.json().total).toBe(1);
  });

  it('filters by status', async () => {
    seedLog({ status: 'success' });
    seedLog({ status: 'error' });

    const res = await app.inject({
      method: 'GET',
      url: '/api/logs?status=error',
      headers: { cookie },
    });

    expect(res.json().total).toBe(1);
    expect(res.json().rows[0].status).toBe('error');
  });

  it('requires admin auth', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/logs',
    });
    expect(res.statusCode).toBe(401);
  });
});
