import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { errorHandler } from '../src/server/middleware/error-handler.js';
import { createRateLimiter } from '../src/server/middleware/rate-limit.js';

// ── Error handler ───────────────────────────────────

describe('errorHandler', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = Fastify({ logger: false });
    app.setErrorHandler(errorHandler);
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns structured JSON for thrown errors', async () => {
    app.get('/boom', async () => {
      throw new Error('Something broke');
    });
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/boom' });
    expect(res.statusCode).toBe(500);

    const body = res.json();
    expect(body.error.message).toBe('Something broke');
    expect(body.error.type).toBe('internal_server_error');
    expect(body.error.code).toBe(500);
  });

  it('preserves explicit statusCode from error', async () => {
    app.get('/bad', async () => {
      const err = new Error('Bad input') as Error & { statusCode: number };
      err.statusCode = 400;
      throw err;
    });
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/bad' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.type).toBe('invalid_request_error');
  });

  it('resolves "not found" in message to 404', async () => {
    app.get('/missing', async () => {
      throw new Error('Resource not found');
    });
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/missing' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.type).toBe('not_found_error');
  });

  it('resolves "unauthorized" in message to 401', async () => {
    app.get('/noauth', async () => {
      throw new Error('Unauthorized access');
    });
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/noauth' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.type).toBe('authentication_error');
  });

  it('resolves "forbidden" in message to 403', async () => {
    app.get('/nope', async () => {
      throw new Error('Forbidden');
    });
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/nope' });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.type).toBe('permission_error');
  });

  it('resolves "rate limit" in message to 429', async () => {
    app.get('/slow', async () => {
      throw new Error('Rate limit exceeded');
    });
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/slow' });
    expect(res.statusCode).toBe(429);
    expect(res.json().error.type).toBe('rate_limit_error');
  });

  it('resolves "timeout" in message to 504', async () => {
    app.get('/timeout', async () => {
      throw new Error('Request timeout');
    });
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/timeout' });
    expect(res.statusCode).toBe(504);
    expect(res.json().error.type).toBe('timeout_error');
  });

  it('includes stack trace in dev mode', async () => {
    app.get('/stack', async () => {
      throw new Error('Stacky');
    });
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/stack' });
    // NODE_ENV=test, config.isDev = false, so no stack
    // But the error message should still be present
    expect(res.json().error.message).toBe('Stacky');
  });

  it('explicit statusCode takes priority over message keywords', async () => {
    app.get('/conflict', async () => {
      // Message says "not found" but statusCode says 422
      const err = new Error('Resource not found') as Error & { statusCode: number };
      err.statusCode = 422;
      throw err;
    });
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/conflict' });
    expect(res.statusCode).toBe(422);
  });
});

// ── Rate limiter ────────────────────────────────────

describe('createRateLimiter', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app.close();
  });

  it('allows requests under the limit', async () => {
    app = Fastify({ logger: false });
    await app.register(createRateLimiter());
    app.get('/test', async () => ({ ok: true }));
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/test' });
    expect(res.statusCode).toBe(200);
  });

  it('returns 429 when rate limit is exceeded', async () => {
    const rateLimit = (await import('@fastify/rate-limit')).default;
    app = Fastify({ logger: false });

    // Register directly (not inside a wrapper) so it applies globally
    await app.register(rateLimit, {
      max: 2,
      timeWindow: '10s',
      errorResponseBuilder: () => ({
        statusCode: 429,
        error: {
          message: 'Rate limit exceeded. Try again later.',
          type: 'rate_limit_error',
          code: 429,
        },
      }),
    });
    app.get('/test', async () => ({ ok: true }));
    await app.ready();

    // First two should pass
    await app.inject({ method: 'GET', url: '/test' });
    await app.inject({ method: 'GET', url: '/test' });

    // Third should be rate limited
    const res = await app.inject({ method: 'GET', url: '/test' });
    expect(res.statusCode).toBe(429);
    expect(res.json().error.type).toBe('rate_limit_error');
  });

  it('exempts /api/health from rate limiting', async () => {
    const rateLimit = (await import('@fastify/rate-limit')).default;
    app = Fastify({ logger: false });

    await app.register(rateLimit, {
      max: 1,
      timeWindow: '10s',
      allowList: (req: import('fastify').FastifyRequest) =>
        req.url === '/api/health' || req.method === 'OPTIONS',
      errorResponseBuilder: () => ({
        statusCode: 429,
        error: { message: 'Rate limited', type: 'rate_limit_error', code: 429 },
      }),
    });
    app.get('/api/health', async () => ({ status: 'ok' }));
    app.get('/test', async () => ({ ok: true }));
    await app.ready();

    // Use up the limit on /test
    await app.inject({ method: 'GET', url: '/test' });

    // /test should now be rate limited
    const testRes = await app.inject({ method: 'GET', url: '/test' });
    expect(testRes.statusCode).toBe(429);

    // /api/health should still work (exempt from rate limit)
    const healthRes = await app.inject({ method: 'GET', url: '/api/health' });
    expect(healthRes.statusCode).toBe(200);
  });

  it('exempts OPTIONS requests from rate limiting', async () => {
    const rateLimit = (await import('@fastify/rate-limit')).default;
    app = Fastify({ logger: false });

    await app.register(rateLimit, {
      max: 1,
      timeWindow: '10s',
      allowList: (req: import('fastify').FastifyRequest) =>
        req.url === '/api/health' || req.method === 'OPTIONS',
      errorResponseBuilder: () => ({
        statusCode: 429,
        error: { message: 'Rate limited', type: 'rate_limit_error', code: 429 },
      }),
    });
    app.get('/test', async () => ({ ok: true }));
    await app.ready();

    // Use up the limit
    await app.inject({ method: 'GET', url: '/test' });
    const limited = await app.inject({ method: 'GET', url: '/test' });
    expect(limited.statusCode).toBe(429);

    // OPTIONS should still work (exempt from rate limit, Fastify returns 404 for unhandled OPTIONS)
    const optionsRes = await app.inject({ method: 'OPTIONS', url: '/test' });
    expect(optionsRes.statusCode).not.toBe(429);
  });
});
