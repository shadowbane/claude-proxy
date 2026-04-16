import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { createTestDb, seedTestAdmin, buildTestApp, loginAs } from './helpers.js';
import type { FastifyInstance } from 'fastify';

let db: Database.Database;
let app: FastifyInstance;

beforeEach(async () => {
  db = createTestDb();
  await seedTestAdmin(db);
  app = await buildTestApp(db);
});

afterEach(async () => {
  await app.close();
  db.close();
  vi.restoreAllMocks();
});

// ── POST /api/auth/login ────────────────────────────

describe('POST /api/auth/login', () => {
  it('returns admin info and sets httpOnly cookie on success', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin', password: 'testpass123' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.username).toBe('admin');
    expect(body.id).toBeTruthy();

    const cookie = res.headers['set-cookie'];
    expect(cookie).toBeDefined();
    expect(String(cookie)).toContain('token=');
    expect(String(cookie)).toContain('HttpOnly');
  });

  it('returns 401 for wrong password', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin', password: 'wrongpassword' },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error.message).toBe('Invalid credentials');
  });

  it('returns 401 for non-existent user', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'nobody', password: 'whatever' },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error.message).toBe('Invalid credentials');
  });

  it('returns 400 when username is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { password: 'test' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toContain('required');
  });

  it('returns 400 when password is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toContain('required');
  });

  it('returns 400 when body is empty', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {},
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns 401 for empty string credentials', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: '', password: '' },
    });

    // Empty strings are falsy, so caught by the !username || !password check
    expect(res.statusCode).toBe(400);
  });

  it('does not leak whether username exists (same error for bad user vs bad pass)', async () => {
    const badUser = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'nobody', password: 'wrong' },
    });
    const badPass = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin', password: 'wrong' },
    });

    expect(badUser.statusCode).toBe(badPass.statusCode);
    expect(badUser.json().error.message).toBe(badPass.json().error.message);
  });
});

// ── POST /api/auth/logout ───────────────────────────

describe('POST /api/auth/logout', () => {
  it('clears the token cookie', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().message).toBe('Logged out');

    const cookie = String(res.headers['set-cookie']);
    // Cookie should be cleared (expires in the past or empty value)
    expect(cookie).toContain('token=');
  });

  it('works even without a prior login', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
    });

    expect(res.statusCode).toBe(200);
  });
});

// ── GET /api/auth/me ────────────────────────────────

describe('GET /api/auth/me', () => {
  it('returns admin info when authenticated', async () => {
    const cookie = await loginAs(app, 'admin', 'testpass123');

    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.username).toBe('admin');
    expect(body.id).toBeTruthy();
    expect(body.created_at).toBeTruthy();
    // Should NOT include password_hash
    expect(body.password_hash).toBeUndefined();
  });

  it('returns 401 without cookie', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error.type).toBe('authentication_error');
  });

  it('returns 401 with invalid JWT', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: 'token=invalid.jwt.token' },
    });

    expect(res.statusCode).toBe(401);
  });

  it('returns 401 with expired JWT', async () => {
    // Sign a token with an exp claim in the past
    const token = app.jwt.sign(
      { id: 'fake', username: 'admin', exp: Math.floor(Date.now() / 1000) - 60 },
    );

    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: `token=${token}` },
    });

    expect(res.statusCode).toBe(401);
  });

  it('returns 404 if admin was deleted after JWT was issued', async () => {
    const cookie = await loginAs(app, 'admin', 'testpass123');

    // Delete the admin from DB
    db.prepare('DELETE FROM admins').run();

    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.message).toBe('Admin not found');
  });
});

// ── POST /api/auth/change-password ──────────────────

describe('POST /api/auth/change-password', () => {
  it('changes password successfully', async () => {
    const cookie = await loginAs(app, 'admin', 'testpass123');

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      headers: { cookie },
      payload: { current_password: 'testpass123', new_password: 'newpass456' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().message).toBe('Password changed successfully');

    // Verify new password works for login
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin', password: 'newpass456' },
    });
    expect(loginRes.statusCode).toBe(200);

    // Verify old password no longer works
    const oldLoginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin', password: 'testpass123' },
    });
    expect(oldLoginRes.statusCode).toBe(401);
  });

  it('returns 401 without authentication', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      payload: { current_password: 'testpass123', new_password: 'newpass456' },
    });

    expect(res.statusCode).toBe(401);
  });

  it('returns 401 when current password is wrong', async () => {
    const cookie = await loginAs(app, 'admin', 'testpass123');

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      headers: { cookie },
      payload: { current_password: 'wrongcurrent', new_password: 'newpass456' },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error.message).toBe('Current password is incorrect');
  });

  it('returns 400 when new password is too short', async () => {
    const cookie = await loginAs(app, 'admin', 'testpass123');

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      headers: { cookie },
      payload: { current_password: 'testpass123', new_password: 'short' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toContain('at least 6');
  });

  it('returns 400 when fields are missing', async () => {
    const cookie = await loginAs(app, 'admin', 'testpass123');

    // Missing new_password
    const res1 = await app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      headers: { cookie },
      payload: { current_password: 'testpass123' },
    });
    expect(res1.statusCode).toBe(400);

    // Missing current_password
    const res2 = await app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      headers: { cookie },
      payload: { new_password: 'newpass456' },
    });
    expect(res2.statusCode).toBe(400);

    // Empty body
    const res3 = await app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      headers: { cookie },
      payload: {},
    });
    expect(res3.statusCode).toBe(400);
  });

  it('returns 404 if admin was deleted after JWT was issued', async () => {
    const cookie = await loginAs(app, 'admin', 'testpass123');

    db.prepare('DELETE FROM admins').run();

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      headers: { cookie },
      payload: { current_password: 'testpass123', new_password: 'newpass456' },
    });

    expect(res.statusCode).toBe(404);
  });

  it('allows changing password to exactly 6 characters (boundary)', async () => {
    const cookie = await loginAs(app, 'admin', 'testpass123');

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      headers: { cookie },
      payload: { current_password: 'testpass123', new_password: 'sixchr' },
    });

    expect(res.statusCode).toBe(200);
  });

  it('allows changing password to same as current', async () => {
    const cookie = await loginAs(app, 'admin', 'testpass123');

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      headers: { cookie },
      payload: { current_password: 'testpass123', new_password: 'testpass123' },
    });

    expect(res.statusCode).toBe(200);
  });
});

// ── Multiple admins ─────────────────────────────────

describe('multiple admins', () => {
  it('each admin gets their own session', async () => {
    await seedTestAdmin(db, 'admin2', 'pass2');

    const cookie1 = await loginAs(app, 'admin', 'testpass123');
    const cookie2 = await loginAs(app, 'admin2', 'pass2');

    const me1 = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: cookie1 },
    });
    const me2 = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: cookie2 },
    });

    expect(me1.json().username).toBe('admin');
    expect(me2.json().username).toBe('admin2');
    expect(me1.json().id).not.toBe(me2.json().id);
  });
});
