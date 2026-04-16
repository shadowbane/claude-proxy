// Proxy auth middleware — Bearer token verification for /v1/* routes
import type { FastifyRequest, FastifyReply } from 'fastify';
import { hashToken } from '../lib/crypto.js';
import { findByHash, touchLastUsed } from '../db/repositories/api-token.js';

declare module 'fastify' {
  interface FastifyRequest {
    proxyAuth?: {
      userId: string;
      tokenId: string;
    };
  }
}

/**
 * Fastify preHandler hook that authenticates proxy requests via Bearer token.
 * Extracts the token from Authorization header, SHA-256 hashes it, looks up
 * in api_tokens, validates both token and user are enabled, then attaches
 * userId + tokenId to the request.
 */
export async function proxyAuth(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const authHeader = request.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return reply.status(401).send({
      error: { message: 'Missing or invalid Authorization header', type: 'authentication_error' },
    });
  }

  const rawToken = authHeader.slice(7);
  if (!rawToken) {
    return reply.status(401).send({
      error: { message: 'Empty API key', type: 'authentication_error' },
    });
  }

  const hash = hashToken(rawToken);
  const tokenRow = findByHash(hash);

  if (!tokenRow) {
    return reply.status(401).send({
      error: { message: 'Invalid API key', type: 'authentication_error' },
    });
  }

  if (!tokenRow.enabled) {
    return reply.status(401).send({
      error: { message: 'API key is disabled', type: 'authentication_error' },
    });
  }

  if (!tokenRow.user_enabled) {
    return reply.status(403).send({
      error: { message: 'User account is disabled', type: 'permission_error' },
    });
  }

  request.proxyAuth = {
    userId: tokenRow.user_id,
    tokenId: tokenRow.id,
  };

  // Update last_used_at (synchronous, fire-and-forget)
  touchLastUsed(tokenRow.id);
}
