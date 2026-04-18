// Credit override routes — CRUD for per-user temporary monthly credit limit changes
import type { FastifyPluginAsync } from 'fastify';
import { adminAuth } from '../middleware/admin-auth.js';
import { getUserById } from '../db/repositories/user.js';
import {
  listCreditOverrides,
  createCreditOverride,
  deleteCreditOverride,
} from '../db/repositories/credit.js';
import type { CreditOverrideCreate } from '../../shared/types.js';

export const creditOverrideRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', adminAuth);

  // GET /api/users/:userId/credit-overrides
  fastify.get<{ Params: { userId: string } }>(
    '/users/:userId/credit-overrides',
    async (request, reply) => {
      const user = getUserById(request.params.userId);
      if (!user) {
        return reply.status(404).send({
          error: { message: 'User not found', type: 'not_found_error', code: 404 },
        });
      }
      return listCreditOverrides(request.params.userId);
    },
  );

  // POST /api/users/:userId/credit-overrides
  fastify.post<{ Params: { userId: string }; Body: CreditOverrideCreate }>(
    '/users/:userId/credit-overrides',
    async (request, reply) => {
      const user = getUserById(request.params.userId);
      if (!user) {
        return reply.status(404).send({
          error: { message: 'User not found', type: 'not_found_error', code: 404 },
        });
      }

      const { start_date, end_date, max_credits, note } = request.body;

      if (
        !start_date ||
        !end_date ||
        !/^\d{4}-\d{2}-\d{2}$/.test(start_date) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(end_date)
      ) {
        return reply.status(400).send({
          error: { message: 'start_date and end_date are required in YYYY-MM-DD format', type: 'invalid_request_error', code: 400 },
        });
      }

      if (end_date < start_date) {
        return reply.status(400).send({
          error: { message: 'end_date must be >= start_date', type: 'invalid_request_error', code: 400 },
        });
      }

      if (
        max_credits == null ||
        typeof max_credits !== 'number' ||
        max_credits < 0 ||
        !Number.isInteger(max_credits)
      ) {
        return reply.status(400).send({
          error: { message: 'max_credits must be a non-negative integer', type: 'invalid_request_error', code: 400 },
        });
      }

      const override = createCreditOverride(request.params.userId, {
        start_date,
        end_date,
        max_credits,
        note,
      });
      return reply.status(201).send(override);
    },
  );

  // DELETE /api/users/:userId/credit-overrides/:overrideId
  fastify.delete<{ Params: { userId: string; overrideId: string } }>(
    '/users/:userId/credit-overrides/:overrideId',
    async (request, reply) => {
      const deleted = deleteCreditOverride(request.params.overrideId);
      if (!deleted) {
        return reply.status(404).send({
          error: { message: 'Override not found', type: 'not_found_error', code: 404 },
        });
      }
      return reply.status(204).send();
    },
  );
};
