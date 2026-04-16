// Test helpers — isolated DB and Fastify app builder
import Database from 'better-sqlite3';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyJwt from '@fastify/jwt';
import fastifyCookie from '@fastify/cookie';
import { SCHEMA_SQL } from '../src/server/db/schema.js';
import { hashPassword } from '../src/server/lib/crypto.js';
import { errorHandler } from '../src/server/middleware/error-handler.js';
import { authRoutes } from '../src/server/routes/auth.js';
import { userRoutes } from '../src/server/routes/users.js';
import { tokenRoutes } from '../src/server/routes/tokens.js';
import * as connectionModule from '../src/server/db/connection.js';
import { vi } from 'vitest';

/**
 * Create a fresh in-memory SQLite database with schema applied.
 * Returns the db instance and a cleanup function.
 */
export function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA_SQL);
  return db;
}

/**
 * Seed a test admin into the given database.
 * Returns the admin row.
 */
export async function seedTestAdmin(
  db: Database.Database,
  username = 'admin',
  password = 'testpass123',
) {
  const hash = await hashPassword(password);
  return db
    .prepare('INSERT INTO admins (username, password_hash) VALUES (?, ?) RETURNING *')
    .get(username, hash) as { id: string; username: string; password_hash: string };
}

/**
 * Mock getDb() to return the given test database.
 * Call this in beforeEach so every test gets an isolated DB.
 */
export function mockGetDb(db: Database.Database) {
  vi.spyOn(connectionModule, 'getDb').mockReturnValue(db);
}

/**
 * Build a minimal Fastify app with JWT, cookie, error handler, and auth routes.
 * Uses the provided test DB via mocked getDb().
 */
export async function buildTestApp(db: Database.Database): Promise<FastifyInstance> {
  mockGetDb(db);

  const app = Fastify({ logger: false });

  app.setErrorHandler(errorHandler);

  await app.register(fastifyJwt, {
    secret: 'test-jwt-secret',
    cookie: { cookieName: 'token', signed: false },
  });
  await app.register(fastifyCookie);
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(userRoutes, { prefix: '/api/users' });
  await app.register(tokenRoutes, { prefix: '/api' });

  app.get('/api/health', async () => ({ status: 'ok' }));

  await app.ready();
  return app;
}

/**
 * Login helper — returns the cookie header string for authenticated requests.
 */
export async function loginAs(
  app: FastifyInstance,
  username: string,
  password: string,
): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username, password },
  });
  const cookie = res.headers['set-cookie'];
  if (!cookie) throw new Error('No cookie returned from login');
  // set-cookie can be string or string[]
  return Array.isArray(cookie) ? cookie[0] : cookie;
}
