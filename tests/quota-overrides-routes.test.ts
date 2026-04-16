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

  // Create a test user
  const res = await app.inject({
    method: 'POST',
    url: '/api/users',
    headers: { cookie },
    payload: { name: 'Quota Test User', daily_token_quota: 10000 },
  });
  userId = res.json().id;
});

afterEach(async () => {
  await app.close();
  db.close();
  vi.restoreAllMocks();
});

// ── Quota Override CRUD ────────────────────────────

describe('GET /api/users/:id/quota-overrides', () => {
  it('lists overrides for a user', async () => {
    // Create two overrides
    await app.inject({
      method: 'POST',
      url: `/api/users/${userId}/quota-overrides`,
      headers: { cookie },
      payload: { start_date: '2026-04-10', end_date: '2026-04-15', max_tokens: 5000 },
    });
    await app.inject({
      method: 'POST',
      url: `/api/users/${userId}/quota-overrides`,
      headers: { cookie },
      payload: { start_date: '2026-04-20', end_date: '2026-04-25', max_tokens: 8000, note: 'project deadline' },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/users/${userId}/quota-overrides`,
      headers: { cookie },
    });

    expect(res.statusCode).toBe(200);
    const overrides = res.json();
    expect(overrides).toHaveLength(2);
  });

  it('returns 404 for non-existent user', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/users/nonexistent/quota-overrides',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('POST /api/users/:id/quota-overrides', () => {
  it('creates an override', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/users/${userId}/quota-overrides`,
      headers: { cookie },
      payload: {
        start_date: '2026-04-15',
        end_date: '2026-04-20',
        max_tokens: 50000,
        note: 'conference week',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toBeTruthy();
    expect(body.user_id).toBe(userId);
    expect(body.start_date).toBe('2026-04-15');
    expect(body.end_date).toBe('2026-04-20');
    expect(body.max_tokens).toBe(50000);
    expect(body.note).toBe('conference week');
  });

  it('rejects end_date < start_date', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/users/${userId}/quota-overrides`,
      headers: { cookie },
      payload: { start_date: '2026-04-20', end_date: '2026-04-15', max_tokens: 5000 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toContain('end_date');
  });

  it('rejects negative max_tokens', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/users/${userId}/quota-overrides`,
      headers: { cookie },
      payload: { start_date: '2026-04-15', end_date: '2026-04-20', max_tokens: -100 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toContain('max_tokens');
  });

  it('rejects non-integer max_tokens', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/users/${userId}/quota-overrides`,
      headers: { cookie },
      payload: { start_date: '2026-04-15', end_date: '2026-04-20', max_tokens: 50.5 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects invalid date format', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/users/${userId}/quota-overrides`,
      headers: { cookie },
      payload: { start_date: 'April 15', end_date: '2026-04-20', max_tokens: 5000 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 for non-existent user', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/users/nonexistent/quota-overrides',
      headers: { cookie },
      payload: { start_date: '2026-04-15', end_date: '2026-04-20', max_tokens: 5000 },
    });
    expect(res.statusCode).toBe(404);
  });

  it('allows max_tokens = 0 (block all)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/users/${userId}/quota-overrides`,
      headers: { cookie },
      payload: { start_date: '2026-04-15', end_date: '2026-04-20', max_tokens: 0 },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().max_tokens).toBe(0);
  });
});

describe('DELETE /api/users/:id/quota-overrides/:overrideId', () => {
  it('deletes an override', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: `/api/users/${userId}/quota-overrides`,
      headers: { cookie },
      payload: { start_date: '2026-04-15', end_date: '2026-04-20', max_tokens: 5000 },
    });
    const overrideId = createRes.json().id;

    const delRes = await app.inject({
      method: 'DELETE',
      url: `/api/users/${userId}/quota-overrides/${overrideId}`,
      headers: { cookie },
    });
    expect(delRes.statusCode).toBe(204);

    // Verify it's gone
    const listRes = await app.inject({
      method: 'GET',
      url: `/api/users/${userId}/quota-overrides`,
      headers: { cookie },
    });
    expect(listRes.json()).toHaveLength(0);
  });

  it('returns 404 for non-existent override', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/users/${userId}/quota-overrides/nonexistent`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(404);
  });
});

// ── Quota Status Endpoint ──────────────────────────

describe('GET /api/users/:id/quota', () => {
  it('returns quota status for a user', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/users/${userId}/quota`,
      headers: { cookie },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.quota_limit).toBe(10000);
    expect(body.quota_source).toBe('user');
    expect(body.tokens_used).toBe(0);
    expect(body.tokens_remaining).toBe(10000);
    expect(body.window_start).toBeTruthy();
    expect(body.window_end).toBeTruthy();
  });

  it('returns 404 for non-existent user', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/users/nonexistent/quota',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it('reflects override when active', async () => {
    const today = new Date().toISOString().slice(0, 10);
    await app.inject({
      method: 'POST',
      url: `/api/users/${userId}/quota-overrides`,
      headers: { cookie },
      payload: { start_date: today, end_date: today, max_tokens: 99999 },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/users/${userId}/quota`,
      headers: { cookie },
    });

    const body = res.json();
    expect(body.quota_limit).toBe(99999);
    expect(body.quota_source).toBe('override');
    expect(body.override_id).toBeTruthy();
  });

  it('shows unlimited when no quota set', async () => {
    // Create user without quota
    const noQuotaRes = await app.inject({
      method: 'POST',
      url: '/api/users',
      headers: { cookie },
      payload: { name: 'No Quota User' },
    });
    const noQuotaId = noQuotaRes.json().id;

    const res = await app.inject({
      method: 'GET',
      url: `/api/users/${noQuotaId}/quota`,
      headers: { cookie },
    });

    const body = res.json();
    expect(body.quota_limit).toBeNull();
    expect(body.quota_source).toBe('none');
    expect(body.tokens_remaining).toBeNull();
  });
});

// ── Settings: quota_reset_time validation ──────────

describe('PUT /api/settings — quota_reset_time', () => {
  it('accepts valid HH:MM format', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      headers: { cookie },
      payload: { quota_reset_time: '06:00' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().quota_reset_time).toBe('06:00');
  });

  it('rejects invalid format', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      headers: { cookie },
      payload: { quota_reset_time: '6:00' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects invalid hours', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      headers: { cookie },
      payload: { quota_reset_time: '25:00' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects invalid minutes', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      headers: { cookie },
      payload: { quota_reset_time: '12:60' },
    });
    expect(res.statusCode).toBe(400);
  });
});
