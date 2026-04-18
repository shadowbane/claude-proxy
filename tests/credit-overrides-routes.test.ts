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

  const res = await app.inject({
    method: 'POST',
    url: '/api/users',
    headers: { cookie },
    payload: { name: 'Credit Test User', credit_limit: 1_000_000 },
  });
  userId = res.json().id;
});

afterEach(async () => {
  await app.close();
  db.close();
  vi.restoreAllMocks();
});

// ── GET /api/users/:id/credit-overrides ────────────

describe('GET /api/users/:id/credit-overrides', () => {
  it('lists overrides for a user, newest first by start_date', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/users/${userId}/credit-overrides`,
      headers: { cookie },
      payload: { start_date: '2026-04-01', end_date: '2026-04-15', max_credits: 5_000_000 },
    });
    await app.inject({
      method: 'POST',
      url: `/api/users/${userId}/credit-overrides`,
      headers: { cookie },
      payload: { start_date: '2026-05-01', end_date: '2026-05-31', max_credits: 8_000_000, note: 'launch month' },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/users/${userId}/credit-overrides`,
      headers: { cookie },
    });

    expect(res.statusCode).toBe(200);
    const overrides = res.json();
    expect(overrides).toHaveLength(2);
    expect(overrides[0].start_date).toBe('2026-05-01');
    expect(overrides[1].start_date).toBe('2026-04-01');
  });

  it('returns empty array when no overrides', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/users/${userId}/credit-overrides`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('returns 404 for non-existent user', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/users/nonexistent/credit-overrides',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it('requires admin auth', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/users/${userId}/credit-overrides`,
    });
    expect(res.statusCode).toBe(401);
  });
});

// ── POST /api/users/:id/credit-overrides ───────────

describe('POST /api/users/:id/credit-overrides', () => {
  it('creates an override and returns 201', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/users/${userId}/credit-overrides`,
      headers: { cookie },
      payload: {
        start_date: '2026-04-15',
        end_date: '2026-04-30',
        max_credits: 10_000_000,
        note: 'burst allowance',
      },
    });

    expect(res.statusCode).toBe(201);
    const o = res.json();
    expect(o.id).toBeTruthy();
    expect(o.user_id).toBe(userId);
    expect(o.start_date).toBe('2026-04-15');
    expect(o.end_date).toBe('2026-04-30');
    expect(o.max_credits).toBe(10_000_000);
    expect(o.note).toBe('burst allowance');
  });

  it('creates without note', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/users/${userId}/credit-overrides`,
      headers: { cookie },
      payload: { start_date: '2026-04-15', end_date: '2026-04-30', max_credits: 1000 },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().note).toBeNull();
  });

  it('allows max_credits=0 to freeze the user', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/users/${userId}/credit-overrides`,
      headers: { cookie },
      payload: { start_date: '2026-04-15', end_date: '2026-04-30', max_credits: 0 },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().max_credits).toBe(0);
  });

  it('rejects invalid date format', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/users/${userId}/credit-overrides`,
      headers: { cookie },
      payload: { start_date: '2026/04/15', end_date: '2026-04-30', max_credits: 1000 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects end_date before start_date', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/users/${userId}/credit-overrides`,
      headers: { cookie },
      payload: { start_date: '2026-04-30', end_date: '2026-04-15', max_credits: 1000 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('allows end_date equal to start_date (single day)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/users/${userId}/credit-overrides`,
      headers: { cookie },
      payload: { start_date: '2026-04-15', end_date: '2026-04-15', max_credits: 1000 },
    });
    expect(res.statusCode).toBe(201);
  });

  it('rejects negative max_credits', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/users/${userId}/credit-overrides`,
      headers: { cookie },
      payload: { start_date: '2026-04-15', end_date: '2026-04-30', max_credits: -100 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects non-integer max_credits', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/users/${userId}/credit-overrides`,
      headers: { cookie },
      payload: { start_date: '2026-04-15', end_date: '2026-04-30', max_credits: 100.5 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects missing max_credits', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/users/${userId}/credit-overrides`,
      headers: { cookie },
      payload: { start_date: '2026-04-15', end_date: '2026-04-30' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 for non-existent user', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/users/nonexistent/credit-overrides',
      headers: { cookie },
      payload: { start_date: '2026-04-15', end_date: '2026-04-30', max_credits: 1000 },
    });
    expect(res.statusCode).toBe(404);
  });

  it('requires admin auth', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/users/${userId}/credit-overrides`,
      payload: { start_date: '2026-04-15', end_date: '2026-04-30', max_credits: 1000 },
    });
    expect(res.statusCode).toBe(401);
  });
});

// ── DELETE /api/users/:id/credit-overrides/:overrideId ──

describe('DELETE /api/users/:id/credit-overrides/:overrideId', () => {
  it('deletes an override and returns 204', async () => {
    const create = await app.inject({
      method: 'POST',
      url: `/api/users/${userId}/credit-overrides`,
      headers: { cookie },
      payload: { start_date: '2026-04-15', end_date: '2026-04-30', max_credits: 1000 },
    });
    const overrideId = create.json().id;

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/users/${userId}/credit-overrides/${overrideId}`,
      headers: { cookie },
    });
    expect(del.statusCode).toBe(204);

    const list = await app.inject({
      method: 'GET',
      url: `/api/users/${userId}/credit-overrides`,
      headers: { cookie },
    });
    expect(list.json()).toEqual([]);
  });

  it('returns 404 for non-existent override', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/users/${userId}/credit-overrides/nonexistent`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it('requires admin auth', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/users/${userId}/credit-overrides/anything`,
    });
    expect(res.statusCode).toBe(401);
  });
});

// ── Cascade on user delete ─────────────────────────

describe('credit_overrides cascade on user delete', () => {
  it('deleting a user removes their credit overrides', async () => {
    const create = await app.inject({
      method: 'POST',
      url: `/api/users/${userId}/credit-overrides`,
      headers: { cookie },
      payload: { start_date: '2026-04-15', end_date: '2026-04-30', max_credits: 1000 },
    });
    expect(create.statusCode).toBe(201);

    const before = db
      .prepare('SELECT COUNT(*) as c FROM credit_overrides WHERE user_id = ?')
      .get(userId) as { c: number };
    expect(before.c).toBe(1);

    await app.inject({ method: 'DELETE', url: `/api/users/${userId}`, headers: { cookie } });

    const after = db
      .prepare('SELECT COUNT(*) as c FROM credit_overrides WHERE user_id = ?')
      .get(userId) as { c: number };
    expect(after.c).toBe(0);
  });
});
