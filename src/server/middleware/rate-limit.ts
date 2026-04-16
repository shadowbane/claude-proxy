// Rate limiting middleware — uses @fastify/rate-limit
import rateLimit from '@fastify/rate-limit';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { config } from '../config.js';

/**
 * Creates a Fastify rate-limit plugin instance.
 * Health check and OPTIONS preflight requests are exempt.
 */
export function createRateLimiter(): FastifyPluginAsync {
  return async (fastify) => {
    await fastify.register(rateLimit, {
      max: config.rateLimitMax,
      timeWindow: config.rateLimitWindowMs + 'ms',
      allowList: (req: FastifyRequest) =>
        req.url === '/api/health' || req.method === 'OPTIONS',
      errorResponseBuilder: () => ({
        statusCode: 429,
        error: {
          message: 'Rate limit exceeded. Try again later.',
          type: 'rate_limit_error',
          code: 429,
        },
      }),
    });
  };
}
