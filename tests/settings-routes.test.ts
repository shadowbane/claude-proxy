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
});
