// Token routes — CRUD for user API tokens
import type { FastifyPluginAsync } from 'fastify';
import { createApiToken, listByUser, revokeToken, updateToken, revealToken } from '../db/repositories/api-token.js';
import { getUserById } from '../db/repositories/user.js';
import { adminAuth } from '../middleware/admin-auth.js';

export const tokenRoutes: FastifyPluginAsync = async (fastify) => {
  // All token routes require admin auth
  fastify.addHook('preHandler', adminAuth);

  // GET /api/users/:id/tokens — list tokens for a user (masked)
  fastify.get<{ Params: { id: string } }>('/users/:id/tokens', async (request, reply) => {
    const user = getUserById(request.params.id);
    if (!user) {
      return reply.status(404).send({
        error: { message: 'User not found', type: 'not_found_error', code: 404 },
      });
    }
    return listByUser(request.params.id);
  });

  // POST /api/users/:id/tokens — create token (returns raw token once)
  fastify.post<{ Params: { id: string }; Body: { name?: string } }>(
    '/users/:id/tokens',
    async (request, reply) => {
      const user = getUserById(request.params.id);
      if (!user) {
        return reply.status(404).send({
          error: { message: 'User not found', type: 'not_found_error', code: 404 },
        });
      }

      const name = request.body?.name || 'default';
      const { raw, token } = createApiToken(request.params.id, name);

      return reply.status(201).send({ ...token, raw_token: raw });
    },
  );

  // DELETE /api/tokens/:tokenId — revoke a token
  fastify.delete<{ Params: { tokenId: string } }>(
    '/tokens/:tokenId',
    async (request, reply) => {
      const deleted = revokeToken(request.params.tokenId);
      if (!deleted) {
        return reply.status(404).send({
          error: { message: 'Token not found', type: 'not_found_error', code: 404 },
        });
      }
      return reply.status(204).send();
    },
  );

  // PUT /api/tokens/:tokenId — update token (name, enabled)
  fastify.put<{ Params: { tokenId: string }; Body: { name?: string; enabled?: boolean } }>(
    '/tokens/:tokenId',
    async (request, reply) => {
      const updated = updateToken(request.params.tokenId, request.body);
      if (!updated) {
        return reply.status(404).send({
          error: { message: 'Token not found', type: 'not_found_error', code: 404 },
        });
      }
      return updated;
    },
  );

  // POST /api/tokens/:tokenId/reveal — decrypt and show full token
  fastify.post<{ Params: { tokenId: string } }>(
    '/tokens/:tokenId/reveal',
    async (request, reply) => {
      const raw = revealToken(request.params.tokenId);
      if (!raw) {
        return reply.status(404).send({
          error: { message: 'Token not found', type: 'not_found_error', code: 404 },
        });
      }
      return { token: raw };
    },
  );
};
