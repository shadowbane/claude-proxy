// Request logs route — paginated access to raw request logs
import type { FastifyPluginAsync } from 'fastify';
import { adminAuth } from '../middleware/admin-auth.js';
import { getPaginated } from '../db/repositories/request-log.js';

export const requestLogRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', adminAuth);

  fastify.get('/logs', async (request) => {
    const { limit, offset, start, end, user_id, status } = request.query as {
      limit?: string;
      offset?: string;
      start?: string;
      end?: string;
      user_id?: string;
      status?: string;
    };

    const parsedLimit = limit ? Math.min(parseInt(limit, 10) || 50, 200) : 50;
    const parsedOffset = offset ? parseInt(offset, 10) || 0 : 0;

    return getPaginated(parsedLimit, parsedOffset, {
      start,
      end,
      userId: user_id,
      status,
    });
  });
};
