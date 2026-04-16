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
  await app.close();
  db.close();
  vi.restoreAllMocks();
});

// We test proxy auth by hitting the /v1/messages endpoint.
// We mock fetch to avoid actual upstream calls.

function mockFetchSuccess(responseBody = '{"id":"msg_1","type":"message","content":[]}') {
  const mockResponse = new Response(responseBody, {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));
}

describe('proxy auth — Bearer token', () => {
  it('rejects request without Authorization header', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/messages',
      payload: { model: 'test', messages: [{ role: 'user', content: 'Hi' }], max_tokens: 10 },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error.type).toBe('authentication_error');
  });

  it('rejects request with empty Bearer token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/messages',
      headers: { authorization: 'Bearer ' },
      payload: { model: 'test', messages: [{ role: 'user', content: 'Hi' }], max_tokens: 10 },
    });

    expect(res.statusCode).toBe(401);
  });

  it('rejects request with invalid token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/messages',
      headers: { authorization: 'Bearer cp_live_invalidtoken' },
      payload: { model: 'test', messages: [{ role: 'user', content: 'Hi' }], max_tokens: 10 },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error.message).toBe('Invalid API key');
  });

  it('rejects request with non-Bearer auth scheme', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/messages',
      headers: { authorization: 'Basic dXNlcjpwYXNz' },
      payload: { model: 'test', messages: [{ role: 'user', content: 'Hi' }], max_tokens: 10 },
    });

    expect(res.statusCode).toBe(401);
  });

  it('accepts request with valid token', async () => {
    mockFetchSuccess();
    const { rawToken } = await createTestUserWithToken(app, cookie);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/messages',
      headers: { authorization: `Bearer ${rawToken}` },
      payload: { model: 'test', messages: [{ role: 'user', content: 'Hi' }], max_tokens: 10 },
    });

    // Should get a proxied response (200) not an auth error
    expect(res.statusCode).toBe(200);
  });

  it('rejects disabled token', async () => {
    const { tokenId, rawToken } = await createTestUserWithToken(app, cookie);

    // Disable the token
    await app.inject({
      method: 'PUT',
      url: `/api/tokens/${tokenId}`,
      headers: { cookie },
      payload: { enabled: false },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/messages',
      headers: { authorization: `Bearer ${rawToken}` },
      payload: { model: 'test', messages: [{ role: 'user', content: 'Hi' }], max_tokens: 10 },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error.message).toBe('API key is disabled');
  });

  it('rejects token when user is disabled', async () => {
    const { userId, rawToken } = await createTestUserWithToken(app, cookie);

    // Disable the user
    await app.inject({
      method: 'PUT',
      url: `/api/users/${userId}`,
      headers: { cookie },
      payload: { enabled: false },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/messages',
      headers: { authorization: `Bearer ${rawToken}` },
      payload: { model: 'test', messages: [{ role: 'user', content: 'Hi' }], max_tokens: 10 },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.message).toBe('User account is disabled');
  });

  it('updates last_used_at on successful auth', async () => {
    mockFetchSuccess();
    const { tokenId, rawToken } = await createTestUserWithToken(app, cookie);

    // Check initial state
    const before = db.prepare('SELECT last_used_at FROM api_tokens WHERE id = ?').get(tokenId) as { last_used_at: string | null };
    expect(before.last_used_at).toBeNull();

    await app.inject({
      method: 'POST',
      url: '/v1/messages',
      headers: { authorization: `Bearer ${rawToken}` },
      payload: { model: 'test', messages: [{ role: 'user', content: 'Hi' }], max_tokens: 10 },
    });

    const after = db.prepare('SELECT last_used_at FROM api_tokens WHERE id = ?').get(tokenId) as { last_used_at: string | null };
    expect(after.last_used_at).not.toBeNull();
  });

  it('HEAD /v1/messages does not require auth', async () => {
    const res = await app.inject({
      method: 'HEAD',
      url: '/v1/messages',
    });

    expect(res.statusCode).toBe(200);
  });
});
