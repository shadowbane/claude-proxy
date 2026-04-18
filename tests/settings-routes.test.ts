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

// ── GET /api/settings ───────────────────────────────

describe('GET /api/settings', () => {
  it('returns empty object when no settings', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/settings',
      headers: { cookie },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({});
  });

  it('returns all settings', async () => {
    db.prepare("INSERT INTO settings (key, value) VALUES ('model', 'mimo-v2')").run();
    db.prepare("INSERT INTO settings (key, value) VALUES ('max_tokens', '4096')").run();

    const res = await app.inject({
      method: 'GET',
      url: '/api/settings',
      headers: { cookie },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ model: 'mimo-v2', max_tokens: '4096' });
  });

  it('requires admin auth', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/settings',
    });
    expect(res.statusCode).toBe(401);
  });
});

// ── PUT /api/settings ───────────────────────────────

describe('PUT /api/settings', () => {
  it('creates new settings', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      headers: { cookie },
      payload: { active_model: 'mimo-v2', theme: 'dark' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.active_model).toBe('mimo-v2');
    expect(body.theme).toBe('dark');
  });

  it('updates existing settings', async () => {
    db.prepare("INSERT INTO settings (key, value) VALUES ('model', 'old')").run();

    const res = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      headers: { cookie },
      payload: { model: 'new' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().model).toBe('new');
  });

  it('returns 400 for non-string values', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      headers: { cookie },
      payload: { model: 123 },
    });

    expect(res.statusCode).toBe(400);
  });

  it('requires admin auth', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      payload: { model: 'test' },
    });
    expect(res.statusCode).toBe(401);
  });

  // ── credit settings validation ─────────────────

  it('rejects credit_reset_day=0', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      headers: { cookie },
      payload: { credit_reset_day: '0' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects credit_reset_day=29', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      headers: { cookie },
      payload: { credit_reset_day: '29' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('accepts credit_reset_day=15', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      headers: { cookie },
      payload: { credit_reset_day: '15' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().credit_reset_day).toBe('15');
  });

  it('accepts credit_limit_default=-1 (unlimited)', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      headers: { cookie },
      payload: { credit_limit_default: '-1' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().credit_limit_default).toBe('-1');
  });

  it('accepts credit_limit_default=100000', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      headers: { cookie },
      payload: { credit_limit_default: '100000' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('rejects non-integer credit_limit_default', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      headers: { cookie },
      payload: { credit_limit_default: 'foo' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects credit_limit_default less than -1', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      headers: { cookie },
      payload: { credit_limit_default: '-5' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('empty-string credit_reset_day removes the setting', async () => {
    db.prepare("INSERT INTO settings (key, value) VALUES ('credit_reset_day', '15')").run();

    const res = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      headers: { cookie },
      payload: { credit_reset_day: '' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().credit_reset_day).toBeUndefined();
  });
});
