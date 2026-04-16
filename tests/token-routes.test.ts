import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { createTestDb, seedTestAdmin, buildTestApp, loginAs } from './helpers.js';
import type { FastifyInstance } from 'fastify';

let db: Database.Database;
let app: FastifyInstance;
let cookie: string;
let userId: string;

beforeEach(async () => {
  db = createTestDb();
  await seedTestAdmin(db);
  app = await buildTestApp(db);
  cookie = await loginAs(app, 'admin', 'testpass123');

  // Create a test user for token operations
  const userRes = await app.inject({
    method: 'POST',
    url: '/api/users',
    headers: { cookie },
    payload: { name: 'Token User' },
  });
  userId = userRes.json().id;
});

afterEach(async () => {
  await app.close();
  db.close();
  vi.restoreAllMocks();
});

// ── POST /api/users/:id/tokens ─────────────────────

describe('POST /api/users/:id/tokens', () => {
  it('creates a token and returns raw_token once', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/users/${userId}/tokens`,
      headers: { cookie },
      payload: { name: 'my-key' },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.raw_token).toMatch(/^cp_live_[a-f0-9]{48}$/);
    expect(body.name).toBe('my-key');
    expect(body.user_id).toBe(userId);
    expect(body.token_prefix).toBeTruthy();
    expect(body.enabled).toBe(1);
    // Should NOT contain encryption fields
    expect(body.token_hash).toBeUndefined();
    expect(body.token_encrypted).toBeUndefined();
  });

  it('uses "default" name when none provided', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/users/${userId}/tokens`,
      headers: { cookie },
      payload: {},
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().name).toBe('default');
  });

  it('returns 404 for unknown user', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/users/nonexistent/tokens',
      headers: { cookie },
      payload: { name: 'orphan' },
    });

    expect(res.statusCode).toBe(404);
  });

  it('returns 401 without auth', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/users/${userId}/tokens`,
      payload: { name: 'unauthed' },
    });

    expect(res.statusCode).toBe(401);
  });
});

// ── GET /api/users/:id/tokens ──────────────────────

describe('GET /api/users/:id/tokens', () => {
  it('returns empty array when user has no tokens', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/users/${userId}/tokens`,
      headers: { cookie },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('returns masked tokens for a user', async () => {
    // Create two tokens
    await app.inject({
      method: 'POST',
      url: `/api/users/${userId}/tokens`,
      headers: { cookie },
      payload: { name: 'key1' },
    });
    await app.inject({
      method: 'POST',
      url: `/api/users/${userId}/tokens`,
      headers: { cookie },
      payload: { name: 'key2' },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/users/${userId}/tokens`,
      headers: { cookie },
    });

    expect(res.statusCode).toBe(200);
    const tokens = res.json();
    expect(tokens).toHaveLength(2);
    // Verify masked
    expect(tokens[0].token_hash).toBeUndefined();
    expect(tokens[0].token_encrypted).toBeUndefined();
    expect(tokens[0].token_prefix).toBeTruthy();
  });

  it('returns 404 for unknown user', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/users/nonexistent/tokens',
      headers: { cookie },
    });

    expect(res.statusCode).toBe(404);
  });
});

// ── PUT /api/tokens/:tokenId ───────────────────────

describe('PUT /api/tokens/:tokenId', () => {
  it('updates token name', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: `/api/users/${userId}/tokens`,
      headers: { cookie },
      payload: { name: 'old-name' },
    });
    const tokenId = createRes.json().id;

    const res = await app.inject({
      method: 'PUT',
      url: `/api/tokens/${tokenId}`,
      headers: { cookie },
      payload: { name: 'new-name' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe('new-name');
  });

  it('disables a token', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: `/api/users/${userId}/tokens`,
      headers: { cookie },
      payload: { name: 'to-disable' },
    });
    const tokenId = createRes.json().id;

    const res = await app.inject({
      method: 'PUT',
      url: `/api/tokens/${tokenId}`,
      headers: { cookie },
      payload: { enabled: false },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().enabled).toBe(0);
  });

  it('returns 404 for unknown token', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/tokens/nonexistent',
      headers: { cookie },
      payload: { name: 'ghost' },
    });

    expect(res.statusCode).toBe(404);
  });
});

// ── DELETE /api/tokens/:tokenId ────────────────────

describe('DELETE /api/tokens/:tokenId', () => {
  it('revokes a token and returns 204', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: `/api/users/${userId}/tokens`,
      headers: { cookie },
      payload: { name: 'doomed' },
    });
    const tokenId = createRes.json().id;

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/tokens/${tokenId}`,
      headers: { cookie },
    });

    expect(res.statusCode).toBe(204);

    // Confirm gone
    const listRes = await app.inject({
      method: 'GET',
      url: `/api/users/${userId}/tokens`,
      headers: { cookie },
    });
    expect(listRes.json()).toHaveLength(0);
  });

  it('returns 404 for unknown token', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/tokens/nonexistent',
      headers: { cookie },
    });

    expect(res.statusCode).toBe(404);
  });
});

// ── POST /api/tokens/:tokenId/reveal ───────────────

describe('POST /api/tokens/:tokenId/reveal', () => {
  it('returns the full decrypted token', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: `/api/users/${userId}/tokens`,
      headers: { cookie },
      payload: { name: 'secret' },
    });
    const { id: tokenId, raw_token } = createRes.json();

    const res = await app.inject({
      method: 'POST',
      url: `/api/tokens/${tokenId}/reveal`,
      headers: { cookie },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().token).toBe(raw_token);
  });

  it('returns 404 for unknown token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tokens/nonexistent/reveal',
      headers: { cookie },
    });

    expect(res.statusCode).toBe(404);
  });

  it('returns 401 without auth', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: `/api/users/${userId}/tokens`,
      headers: { cookie },
      payload: { name: 'reveal-noauth' },
    });
    const tokenId = createRes.json().id;

    const res = await app.inject({
      method: 'POST',
      url: `/api/tokens/${tokenId}/reveal`,
    });

    expect(res.statusCode).toBe(401);
  });
});

// ── Token cascade on user delete ───────────────────

describe('token cascade', () => {
  it('deleting a user removes all their tokens', async () => {
    // Create tokens
    await app.inject({
      method: 'POST',
      url: `/api/users/${userId}/tokens`,
      headers: { cookie },
      payload: { name: 'key1' },
    });
    await app.inject({
      method: 'POST',
      url: `/api/users/${userId}/tokens`,
      headers: { cookie },
      payload: { name: 'key2' },
    });

    // Delete user
    await app.inject({
      method: 'DELETE',
      url: `/api/users/${userId}`,
      headers: { cookie },
    });

    // Verify tokens are gone at DB level
    const count = db.prepare('SELECT COUNT(*) as count FROM api_tokens WHERE user_id = ?').get(userId) as { count: number };
    expect(count.count).toBe(0);
  });
});
