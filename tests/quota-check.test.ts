import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { createTestDb, seedTestAdmin, buildTestApp, loginAs, createTestUserWithToken } from './helpers.js';
import type { FastifyInstance } from 'fastify';

let db: Database.Database;
let app: FastifyInstance;
let cookie: string;

beforeEach(async () => {
  db = createTestDb();
  await seedTestAdmin(db);
  app = await buildTestApp(db);
  cookie = await loginAs(app, 'admin', 'testpass123');
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await app.close();
  db.close();
  vi.restoreAllMocks();
});

function stubSuccessfulUpstream() {
  const upstreamBody = JSON.stringify({
    id: 'msg_123',
    type: 'message',
    usage: { input_tokens: 100, output_tokens: 50 },
  });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
    new Response(upstreamBody, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  ));
}

function makeProxyRequest(app: FastifyInstance, rawToken: string) {
  return app.inject({
    method: 'POST',
    url: '/v1/messages',
    headers: {
      authorization: `Bearer ${rawToken}`,
      'anthropic-version': '2023-06-01',
    },
    payload: { model: 'test', messages: [{ role: 'user', content: 'Hi' }], max_tokens: 10 },
  });
}

// ── Quota enforcement in proxy ─────────────────────

describe('Quota enforcement in proxy', () => {
  it('returns 200 when user has no quota (unlimited)', async () => {
    stubSuccessfulUpstream();
    const { rawToken } = await createTestUserWithToken(app, cookie);

    const res = await makeProxyRequest(app, rawToken);
    expect(res.statusCode).toBe(200);
  });

  it('returns 200 when user is under quota', async () => {
    stubSuccessfulUpstream();

    // Create user with quota
    const userRes = await app.inject({
      method: 'POST',
      url: '/api/users',
      headers: { cookie },
      payload: { name: 'QuotaUser', daily_token_quota: 1000000 },
    });
    const userId = userRes.json().id;

    const tokenRes = await app.inject({
      method: 'POST',
      url: `/api/users/${userId}/tokens`,
      headers: { cookie },
      payload: { name: 'test-token' },
    });
    const rawToken = tokenRes.json().raw_token;

    const res = await makeProxyRequest(app, rawToken);
    expect(res.statusCode).toBe(200);
  });

  it('returns 429 with type quota_exceeded when over quota', async () => {
    stubSuccessfulUpstream();

    // Create user with very low quota
    const userRes = await app.inject({
      method: 'POST',
      url: '/api/users',
      headers: { cookie },
      payload: { name: 'LimitedUser', daily_token_quota: 50 },
    });
    const userId = userRes.json().id;

    const tokenRes = await app.inject({
      method: 'POST',
      url: `/api/users/${userId}/tokens`,
      headers: { cookie },
      payload: { name: 'test-token' },
    });
    const rawToken = tokenRes.json().raw_token;

    // First request succeeds (0 < 50)
    const res1 = await makeProxyRequest(app, rawToken);
    expect(res1.statusCode).toBe(200);

    // Insert usage to push over quota
    db.prepare(`
      INSERT INTO request_logs (user_id, prompt_tokens, completion_tokens, cache_creation_input_tokens, cache_read_input_tokens, status, created_at)
      VALUES (?, 100, 50, 0, 0, 'success', datetime('now'))
    `).run(userId);

    // Second request should be blocked
    const res2 = await makeProxyRequest(app, rawToken);
    expect(res2.statusCode).toBe(429);

    const body = res2.json();
    expect(body.error.type).toBe('quota_exceeded');
    expect(body.quota).toBeDefined();
    expect(body.quota.tokens_used).toBeGreaterThanOrEqual(150);
    expect(body.quota.quota_limit).toBe(50);
  });

  it('429 response body contains quota status object', async () => {
    stubSuccessfulUpstream();

    const userRes = await app.inject({
      method: 'POST',
      url: '/api/users',
      headers: { cookie },
      payload: { name: 'QuotaInfo', daily_token_quota: 10 },
    });
    const userId = userRes.json().id;

    const tokenRes = await app.inject({
      method: 'POST',
      url: `/api/users/${userId}/tokens`,
      headers: { cookie },
      payload: { name: 'test-token' },
    });
    const rawToken = tokenRes.json().raw_token;

    // Insert usage over quota
    db.prepare(`
      INSERT INTO request_logs (user_id, prompt_tokens, completion_tokens, cache_creation_input_tokens, cache_read_input_tokens, status, created_at)
      VALUES (?, 50, 0, 0, 0, 'success', datetime('now'))
    `).run(userId);

    const res = await makeProxyRequest(app, rawToken);
    expect(res.statusCode).toBe(429);

    const body = res2json(res);
    expect(body.quota.quota_limit).toBe(10);
    expect(body.quota.tokens_used).toBeGreaterThanOrEqual(50);
    expect(body.quota.tokens_remaining).toBe(0);
    expect(body.quota.quota_source).toBe('user');
    expect(body.quota.window_start).toBeTruthy();
    expect(body.quota.window_end).toBeTruthy();
  });

  it('allows when override raises limit above current usage', async () => {
    stubSuccessfulUpstream();

    const userRes = await app.inject({
      method: 'POST',
      url: '/api/users',
      headers: { cookie },
      payload: { name: 'OverrideUser', daily_token_quota: 10 },
    });
    const userId = userRes.json().id;

    const tokenRes = await app.inject({
      method: 'POST',
      url: `/api/users/${userId}/tokens`,
      headers: { cookie },
      payload: { name: 'test-token' },
    });
    const rawToken = tokenRes.json().raw_token;

    // Insert usage over user quota but under override
    db.prepare(`
      INSERT INTO request_logs (user_id, prompt_tokens, completion_tokens, cache_creation_input_tokens, cache_read_input_tokens, status, created_at)
      VALUES (?, 50, 0, 0, 0, 'success', datetime('now'))
    `).run(userId);

    // Without override, should be blocked
    const blocked = await makeProxyRequest(app, rawToken);
    expect(blocked.statusCode).toBe(429);

    // Add override with higher limit
    const today = new Date().toISOString().slice(0, 10);
    await app.inject({
      method: 'POST',
      url: `/api/users/${userId}/quota-overrides`,
      headers: { cookie },
      payload: { start_date: today, end_date: today, max_tokens: 1000 },
    });

    // Now should be allowed
    const allowed = await makeProxyRequest(app, rawToken);
    expect(allowed.statusCode).toBe(200);
  });

  it('blocks when override lowers limit below current usage', async () => {
    stubSuccessfulUpstream();

    const userRes = await app.inject({
      method: 'POST',
      url: '/api/users',
      headers: { cookie },
      payload: { name: 'LowOverrideUser', daily_token_quota: 100000 },
    });
    const userId = userRes.json().id;

    const tokenRes = await app.inject({
      method: 'POST',
      url: `/api/users/${userId}/tokens`,
      headers: { cookie },
      payload: { name: 'test-token' },
    });
    const rawToken = tokenRes.json().raw_token;

    // Insert moderate usage
    db.prepare(`
      INSERT INTO request_logs (user_id, prompt_tokens, completion_tokens, cache_creation_input_tokens, cache_read_input_tokens, status, created_at)
      VALUES (?, 500, 0, 0, 0, 'success', datetime('now'))
    `).run(userId);

    // Without override, under user quota — should pass
    const allowed = await makeProxyRequest(app, rawToken);
    expect(allowed.statusCode).toBe(200);

    // Add override with lower limit
    const today = new Date().toISOString().slice(0, 10);
    await app.inject({
      method: 'POST',
      url: `/api/users/${userId}/quota-overrides`,
      headers: { cookie },
      payload: { start_date: today, end_date: today, max_tokens: 100 },
    });

    // Now should be blocked (500 >= 100)
    const blocked = await makeProxyRequest(app, rawToken);
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().quota.quota_source).toBe('override');
  });
});

function res2json(res: { body: string }) {
  return JSON.parse(res.body);
}
