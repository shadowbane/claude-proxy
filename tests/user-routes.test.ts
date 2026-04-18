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
  await app.close();
  db.close();
  vi.restoreAllMocks();
});

// ── POST /api/users ────────────────────────────────

describe('POST /api/users', () => {
  it('creates a user with all fields', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/users',
      headers: { cookie },
      payload: { name: 'Alice', email: 'alice@example.com' },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.name).toBe('Alice');
    expect(body.email).toBe('alice@example.com');
    expect(body.enabled).toBe(1);
    expect(body.id).toBeTruthy();
    expect(body.created_by).toBeTruthy();
  });

  it('creates a user with only name', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/users',
      headers: { cookie },
      payload: { name: 'Bob' },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().email).toBeNull();
  });

  it('creates a disabled user', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/users',
      headers: { cookie },
      payload: { name: 'Charlie', enabled: false },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().enabled).toBe(0);
  });

  it('returns 400 when name is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/users',
      headers: { cookie },
      payload: { email: 'no-name@test.com' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toContain('Name is required');
  });

  it('returns 400 when name is empty string', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/users',
      headers: { cookie },
      payload: { name: '  ' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns 401 without auth', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/users',
      payload: { name: 'Unauthed' },
    });

    expect(res.statusCode).toBe(401);
  });
});

// ── GET /api/users ─────────────────────────────────

describe('GET /api/users', () => {
  it('returns empty array when no users', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/users',
      headers: { cookie },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('returns all users', async () => {
    await app.inject({ method: 'POST', url: '/api/users', headers: { cookie }, payload: { name: 'A' } });
    await app.inject({ method: 'POST', url: '/api/users', headers: { cookie }, payload: { name: 'B' } });

    const res = await app.inject({
      method: 'GET',
      url: '/api/users',
      headers: { cookie },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(2);
  });

  it('returns 401 without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/users' });
    expect(res.statusCode).toBe(401);
  });
});

// ── GET /api/users/:id ─────────────────────────────

describe('GET /api/users/:id', () => {
  it('returns user by ID', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/users',
      headers: { cookie },
      payload: { name: 'Dave' },
    });
    const userId = createRes.json().id;

    const res = await app.inject({
      method: 'GET',
      url: `/api/users/${userId}`,
      headers: { cookie },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe('Dave');
  });

  it('returns 404 for unknown ID', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/users/nonexistent',
      headers: { cookie },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.type).toBe('not_found_error');
  });
});

// ── GET /api/users/:id/credits ─────────────────────

describe('GET /api/users/:id/credits', () => {
  it('returns credit status for a user', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/users',
      headers: { cookie },
      payload: { name: 'CreditUser', credit_limit: 5000 },
    });
    const userId = createRes.json().id;

    const res = await app.inject({
      method: 'GET',
      url: `/api/users/${userId}/credits`,
      headers: { cookie },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.credit_limit).toBe(5000);
    expect(body.credit_source).toBe('user');
    expect(body.credits_used).toBe(0);
    expect(body.credits_remaining).toBe(5000);
    expect(body.window_start).toBeTruthy();
    expect(body.window_end).toBeTruthy();
    expect(body.reset_day).toBeGreaterThanOrEqual(1);
  });

  it('returns unlimited status when no limit configured', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/users',
      headers: { cookie },
      payload: { name: 'Unlim' },
    });
    const userId = createRes.json().id;

    const res = await app.inject({
      method: 'GET',
      url: `/api/users/${userId}/credits`,
      headers: { cookie },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.credit_limit).toBeNull();
    expect(body.credits_remaining).toBeNull();
    expect(body.credit_source).toBe('none');
  });

  it('returns 404 for unknown user', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/users/nonexistent/credits',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it('requires admin auth', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/users/anything/credits',
    });
    expect(res.statusCode).toBe(401);
  });
});

// ── PUT /api/users/:id ─────────────────────────────

describe('PUT /api/users/:id', () => {
  it('updates user fields', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/users',
      headers: { cookie },
      payload: { name: 'Eve' },
    });
    const userId = createRes.json().id;

    const res = await app.inject({
      method: 'PUT',
      url: `/api/users/${userId}`,
      headers: { cookie },
      payload: { name: 'Eve Updated', email: 'eve@test.com', enabled: false },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.name).toBe('Eve Updated');
    expect(body.email).toBe('eve@test.com');
    expect(body.enabled).toBe(0);
  });

  it('returns 404 for unknown ID', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/users/nonexistent',
      headers: { cookie },
      payload: { name: 'Ghost' },
    });

    expect(res.statusCode).toBe(404);
  });
});

// ── DELETE /api/users/:id ──────────────────────────

describe('DELETE /api/users/:id', () => {
  it('deletes a user and returns 204', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/users',
      headers: { cookie },
      payload: { name: 'Goner' },
    });
    const userId = createRes.json().id;

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/users/${userId}`,
      headers: { cookie },
    });

    expect(res.statusCode).toBe(204);

    // Confirm gone
    const getRes = await app.inject({
      method: 'GET',
      url: `/api/users/${userId}`,
      headers: { cookie },
    });
    expect(getRes.statusCode).toBe(404);
  });

  it('returns 404 for unknown ID', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/users/nonexistent',
      headers: { cookie },
    });

    expect(res.statusCode).toBe(404);
  });
});
