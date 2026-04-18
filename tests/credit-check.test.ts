import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { createTestDb, seedTestAdmin, buildTestApp, loginAs } from './helpers.js';
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

function stubSuccessfulUpstream(usage = { input_tokens: 100, output_tokens: 50 }) {
  const upstreamBody = JSON.stringify({
    id: 'msg_1',
    type: 'message',
    usage,
  });
  // Fresh Response per call — Response bodies are one-shot streams.
  vi.stubGlobal('fetch', vi.fn().mockImplementation(() =>
    Promise.resolve(
      new Response(upstreamBody, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  ));
}

async function createUser(payload: Record<string, unknown>): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/users',
    headers: { cookie },
    payload,
  });
  return res.json().id;
}

async function createToken(userId: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: `/api/users/${userId}/tokens`,
    headers: { cookie },
    payload: { name: 't' },
  });
  return res.json().raw_token;
}

function proxy(rawToken: string, model = 'mimo-v2-pro') {
  return app.inject({
    method: 'POST',
    url: '/v1/messages',
    headers: { authorization: `Bearer ${rawToken}`, 'anthropic-version': '2023-06-01' },
    payload: { model, messages: [{ role: 'user', content: 'Hi' }], max_tokens: 10 },
  });
}

// Mimic a mimo-v2-pro request that has already consumed credits by inserting
// a populated estimated_credits row directly.
function seedCreditUsage(userId: string, credits: number) {
  db.prepare(`
    INSERT INTO request_logs (user_id, model, prompt_tokens, completion_tokens, cache_creation_input_tokens, cache_read_input_tokens, estimated_credits, status, created_at)
    VALUES (?, 'mimo-v2-pro', 0, 0, 0, 0, ?, 'success', datetime('now'))
  `).run(userId, credits);
}

// ── Enforcement ────────────────────────────────────

describe('Credit limit enforcement in proxy', () => {
  it('allows when user has no credit limit and no default', async () => {
    stubSuccessfulUpstream();
    const userId = await createUser({ name: 'NoLimit' });
    const token = await createToken(userId);
    const res = await proxy(token);
    expect(res.statusCode).toBe(200);
  });

  it('allows when under limit', async () => {
    stubSuccessfulUpstream();
    const userId = await createUser({ name: 'Under', credit_limit: 1000000 });
    const token = await createToken(userId);
    seedCreditUsage(userId, 500);
    const res = await proxy(token);
    expect(res.statusCode).toBe(200);
  });

  it('blocks with 429 and credit_limit_exceeded type when over limit', async () => {
    stubSuccessfulUpstream();
    const userId = await createUser({ name: 'Over', credit_limit: 1000 });
    const token = await createToken(userId);
    seedCreditUsage(userId, 1500);

    const res = await proxy(token);
    expect(res.statusCode).toBe(429);
    const body = res.json();
    expect(body.error.type).toBe('credit_limit_exceeded');
    expect(body.credits).toBeDefined();
    expect(body.credits.credit_limit).toBe(1000);
    expect(body.credits.credits_used).toBe(1500);
    expect(body.credits.credits_remaining).toBe(0);
    expect(body.credits.credit_source).toBe('user');
    expect(body.credits.window_start).toBeTruthy();
    expect(body.credits.window_end).toBeTruthy();
    expect(body.credits.reset_day).toBeGreaterThanOrEqual(1);
  });

  it('blocks at exact limit (>= semantics)', async () => {
    stubSuccessfulUpstream();
    const userId = await createUser({ name: 'Exact', credit_limit: 1000 });
    const token = await createToken(userId);
    seedCreditUsage(userId, 1000);

    const res = await proxy(token);
    expect(res.statusCode).toBe(429);
    expect(res.json().error.type).toBe('credit_limit_exceeded');
  });

  it('non-pro usage does not accumulate credits (user stays under limit)', async () => {
    stubSuccessfulUpstream();
    const userId = await createUser({ name: 'OnlyNonPro', credit_limit: 100 });
    const token = await createToken(userId);
    // Non-pro row: estimated_credits NULL, which the sum excludes.
    db.prepare(`
      INSERT INTO request_logs (user_id, model, prompt_tokens, completion_tokens, cache_creation_input_tokens, cache_read_input_tokens, estimated_credits, status, created_at)
      VALUES (?, 'mimo-v2-lite', 10000, 2000, 0, 0, NULL, 'success', datetime('now'))
    `).run(userId);

    const res = await proxy(token);
    expect(res.statusCode).toBe(200);
  });

  it('daily quota fires first when both are tripped', async () => {
    stubSuccessfulUpstream();
    const userId = await createUser({
      name: 'Both',
      daily_token_quota: 10,      // very low
      credit_limit: 100,          // also low
    });
    const token = await createToken(userId);
    // Trip the daily quota via plain token usage.
    db.prepare(`
      INSERT INTO request_logs (user_id, prompt_tokens, completion_tokens, cache_creation_input_tokens, cache_read_input_tokens, estimated_credits, status, created_at)
      VALUES (?, 100, 50, 0, 0, 1000, 'success', datetime('now'))
    `).run(userId);

    const res = await proxy(token);
    expect(res.statusCode).toBe(429);
    // quotaCheck runs before creditCheck in the preHandler list → its error body is returned
    expect(res.json().error.type).toBe('quota_exceeded');
  });

  it('credit_limit blocks independently when daily quota is unlimited', async () => {
    stubSuccessfulUpstream();
    const userId = await createUser({
      name: 'CreditOnly',
      daily_token_quota: -1,     // explicitly unlimited
      credit_limit: 1000,
    });
    const token = await createToken(userId);
    seedCreditUsage(userId, 2000);

    const res = await proxy(token);
    expect(res.statusCode).toBe(429);
    expect(res.json().error.type).toBe('credit_limit_exceeded');
  });

  it('uses global credit_limit_default when user has no per-user limit', async () => {
    stubSuccessfulUpstream();
    db.prepare("INSERT INTO settings (key, value) VALUES ('credit_limit_default', '500')").run();

    const userId = await createUser({ name: 'UsesDefault' });
    const token = await createToken(userId);
    seedCreditUsage(userId, 1000);

    const res = await proxy(token);
    expect(res.statusCode).toBe(429);
    const body = res.json();
    expect(body.error.type).toBe('credit_limit_exceeded');
    expect(body.credits.credit_source).toBe('default');
    expect(body.credits.credit_limit).toBe(500);
  });
});

// ── End-to-end per-model credit accrual ──────────────
//
// These exercise the full pipeline: upstream response → usage-extractor →
// credit-calculator → request_logs → credit-check. Live proof that each
// MiMo model is billed at the correct multiplier.

describe('Per-model credit accrual end-to-end', () => {
  function lastLog(userId: string) {
    return db
      .prepare('SELECT model, estimated_credits FROM request_logs WHERE user_id = ? ORDER BY id DESC LIMIT 1')
      .get(userId) as { model: string; estimated_credits: number | null } | undefined;
  }

  it('mimo-v2-pro accrues at 2× (input + output)', async () => {
    stubSuccessfulUpstream({ input_tokens: 1000, output_tokens: 500 });
    const userId = await createUser({ name: 'ProUser' });
    const token = await createToken(userId);

    const res = await proxy(token, 'mimo-v2-pro');
    expect(res.statusCode).toBe(200);

    const row = lastLog(userId);
    expect(row?.model).toBe('mimo-v2-pro');
    expect(row?.estimated_credits).toBe((1000 + 500) * 2);
  });

  it('mimo-v2-omni accrues at 1× (input + output)', async () => {
    stubSuccessfulUpstream({ input_tokens: 1000, output_tokens: 500 });
    const userId = await createUser({ name: 'OmniUser' });
    const token = await createToken(userId);

    const res = await proxy(token, 'mimo-v2-omni');
    expect(res.statusCode).toBe(200);

    const row = lastLog(userId);
    expect(row?.model).toBe('mimo-v2-omni');
    expect(row?.estimated_credits).toBe(1000 + 500);
  });

  it('mimo-v2-tts accrues at 0 (free)', async () => {
    stubSuccessfulUpstream({ input_tokens: 1000, output_tokens: 500 });
    const userId = await createUser({ name: 'TtsUser' });
    const token = await createToken(userId);

    const res = await proxy(token, 'mimo-v2-tts');
    expect(res.statusCode).toBe(200);

    const row = lastLog(userId);
    expect(row?.model).toBe('mimo-v2-tts');
    expect(row?.estimated_credits).toBe(0);
  });

  it('unknown model records estimated_credits=null (excluded from credit sum)', async () => {
    stubSuccessfulUpstream({ input_tokens: 1000, output_tokens: 500 });
    const userId = await createUser({ name: 'UnknownModelUser' });
    const token = await createToken(userId);

    const res = await proxy(token, 'mimo-v2-lite');
    expect(res.statusCode).toBe(200);

    const row = lastLog(userId);
    expect(row?.model).toBe('mimo-v2-lite');
    expect(row?.estimated_credits).toBeNull();
  });

  it('mimo-v2-omni counts toward the credit limit and can trip it', async () => {
    stubSuccessfulUpstream({ input_tokens: 100, output_tokens: 50 });
    const userId = await createUser({ name: 'OmniLimit', credit_limit: 1000 });
    const token = await createToken(userId);

    // Seed an omni row already inside the window that takes the user over the limit.
    db.prepare(`
      INSERT INTO request_logs (user_id, model, prompt_tokens, completion_tokens, cache_creation_input_tokens, cache_read_input_tokens, estimated_credits, status, created_at)
      VALUES (?, 'mimo-v2-omni', 0, 0, 0, 0, 1500, 'success', datetime('now'))
    `).run(userId);

    const res = await proxy(token, 'mimo-v2-omni');
    expect(res.statusCode).toBe(429);
    expect(res.json().error.type).toBe('credit_limit_exceeded');
  });

  // tts coexistence test continues below
  it('mimo-v2-tts usage does NOT accumulate toward the credit limit', async () => {
    stubSuccessfulUpstream({ input_tokens: 10_000, output_tokens: 5_000 });
    const userId = await createUser({ name: 'TtsOnly', credit_limit: 100 });
    const token = await createToken(userId);

    // Even a massive tts burst stays at 0 credits
    const res1 = await proxy(token, 'mimo-v2-tts');
    expect(res1.statusCode).toBe(200);
    const res2 = await proxy(token, 'mimo-v2-tts');
    expect(res2.statusCode).toBe(200);

    // Credit sum from request_logs
    const row = db
      .prepare("SELECT COALESCE(SUM(estimated_credits), 0) as total FROM request_logs WHERE user_id = ? AND estimated_credits IS NOT NULL")
      .get(userId) as { total: number };
    expect(row.total).toBe(0);
  });
});

// ── Credit overrides in proxy enforcement ───────────

describe('Credit override enforcement in proxy', () => {
  it('override raises limit above current usage — request is allowed', async () => {
    stubSuccessfulUpstream();
    const userId = await createUser({ name: 'OverrideUp', credit_limit: 1000 });
    const token = await createToken(userId);

    seedCreditUsage(userId, 1500); // over user limit

    const blocked = await proxy(token);
    expect(blocked.statusCode).toBe(429);

    // Add override active today with higher limit
    const today = new Date().toISOString().slice(0, 10);
    const oRes = await app.inject({
      method: 'POST',
      url: `/api/users/${userId}/credit-overrides`,
      headers: { cookie },
      payload: { start_date: today, end_date: today, max_credits: 5000 },
    });
    expect(oRes.statusCode).toBe(201);

    const allowed = await proxy(token);
    expect(allowed.statusCode).toBe(200);
  });

  it('override lowers limit below current usage — request is blocked and 429 reports source=override', async () => {
    stubSuccessfulUpstream();
    const userId = await createUser({ name: 'OverrideDown', credit_limit: 100_000_000 });
    const token = await createToken(userId);

    seedCreditUsage(userId, 500);

    // Unblocked under generous user limit
    const allowed = await proxy(token);
    expect(allowed.statusCode).toBe(200);

    const today = new Date().toISOString().slice(0, 10);
    await app.inject({
      method: 'POST',
      url: `/api/users/${userId}/credit-overrides`,
      headers: { cookie },
      payload: { start_date: today, end_date: today, max_credits: 100 },
    });

    const blocked = await proxy(token);
    expect(blocked.statusCode).toBe(429);
    const body = blocked.json();
    expect(body.error.type).toBe('credit_limit_exceeded');
    expect(body.credits.credit_source).toBe('override');
    expect(body.credits.credit_limit).toBe(100);
    expect(body.credits.override_id).toBeTruthy();
  });

  it('expired override does not apply — user limit used', async () => {
    stubSuccessfulUpstream();
    const userId = await createUser({ name: 'ExpiredOverride', credit_limit: 100 });
    const token = await createToken(userId);

    seedCreditUsage(userId, 200);

    // Override expired long ago
    await app.inject({
      method: 'POST',
      url: `/api/users/${userId}/credit-overrides`,
      headers: { cookie },
      payload: { start_date: '2020-01-01', end_date: '2020-01-02', max_credits: 999_999 },
    });

    const res = await proxy(token);
    expect(res.statusCode).toBe(429);
    expect(res.json().credits.credit_source).toBe('user');
  });

  it('override with max_credits=0 freezes the user', async () => {
    stubSuccessfulUpstream();
    const userId = await createUser({ name: 'FrozenByOverride', credit_limit: 100_000_000 });
    const token = await createToken(userId);

    const today = new Date().toISOString().slice(0, 10);
    await app.inject({
      method: 'POST',
      url: `/api/users/${userId}/credit-overrides`,
      headers: { cookie },
      payload: { start_date: today, end_date: today, max_credits: 0 },
    });

    const res = await proxy(token);
    expect(res.statusCode).toBe(429);
    expect(res.json().credits.credit_limit).toBe(0);
    expect(res.json().credits.credit_source).toBe('override');
  });
});
