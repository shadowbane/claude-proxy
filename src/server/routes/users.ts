// User routes — CRUD for API consumer accounts
import type { FastifyPluginAsync } from 'fastify';
import { listUsers, getUserById, createUser, updateUser, deleteUser } from '../db/repositories/user.js';
import { getQuotaStatus } from '../db/repositories/quota.js';
import { getCreditStatus } from '../db/repositories/credit.js';
import { adminAuth } from '../middleware/admin-auth.js';
import type { UserCreate, UserUpdate } from '../../shared/types.js';

export const userRoutes: FastifyPluginAsync = async (fastify) => {
  // All user routes require admin auth
  fastify.addHook('preHandler', adminAuth);

  // GET /api/users — list all users
  fastify.get('/', async () => {
    return listUsers();
  });

  // POST /api/users — create a new user
  fastify.post<{ Body: UserCreate }>('/', async (request, reply) => {
    const { name, email, enabled, daily_token_quota, credit_limit } = request.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return reply.status(400).send({
        error: { message: 'Name is required', type: 'invalid_request_error', code: 400 },
      });
    }

    const admin = request.user as { id: string };
    const user = createUser(
      { name: name.trim(), email, enabled, daily_token_quota, credit_limit },
      admin.id,
    );
    return reply.status(201).send(user);
  });

  // GET /api/users/:id — get user detail
  fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const user = getUserById(request.params.id);
    if (!user) {
      return reply.status(404).send({
        error: { message: 'User not found', type: 'not_found_error', code: 404 },
      });
    }
    return user;
  });

  // GET /api/users/:id/quota — get quota status for a user
  fastify.get<{ Params: { id: string } }>('/:id/quota', async (request, reply) => {
    const user = getUserById(request.params.id);
    if (!user) {
      return reply.status(404).send({
        error: { message: 'User not found', type: 'not_found_error', code: 404 },
      });
    }
    return getQuotaStatus(request.params.id);
  });

  // GET /api/users/:id/credits — get monthly credit status for a user
  fastify.get<{ Params: { id: string } }>('/:id/credits', async (request, reply) => {
    const user = getUserById(request.params.id);
    if (!user) {
      return reply.status(404).send({
        error: { message: 'User not found', type: 'not_found_error', code: 404 },
      });
    }
    return getCreditStatus(request.params.id);
  });

  // PUT /api/users/:id — update user
  fastify.put<{ Params: { id: string }; Body: UserUpdate }>('/:id', async (request, reply) => {
    const existing = getUserById(request.params.id);
    if (!existing) {
      return reply.status(404).send({
        error: { message: 'User not found', type: 'not_found_error', code: 404 },
      });
    }

    const updated = updateUser(request.params.id, request.body);
    return updated;
  });

  // DELETE /api/users/:id — delete user (cascades tokens)
  fastify.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const deleted = deleteUser(request.params.id);
    if (!deleted) {
      return reply.status(404).send({
        error: { message: 'User not found', type: 'not_found_error', code: 404 },
      });
    }
    return reply.status(204).send();
  });
};
