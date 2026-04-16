// Request logs route — paginated access to raw request logs + file logs
import type { FastifyPluginAsync } from 'fastify';
import { adminAuth } from '../middleware/admin-auth.js';
import { getPaginated } from '../db/repositories/request-log.js';
import { readFileLog } from '../lib/file-log-reader.js';

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

  fastify.get<{
    Params: { type: string };
    Querystring: {
      limit?: string;
      offset?: string;
      start?: string;
      end?: string;
      level?: string;
    };
  }>('/logs/files/:type', async (request, reply) => {
    const { type } = request.params;
    if (type !== 'app' && type !== 'error') {
      return reply.status(400).send({ error: 'Invalid log type' });
    }
    const limit = Math.min(parseInt(request.query.limit ?? '25', 10) || 25, 500);
    const offset = parseInt(request.query.offset ?? '0', 10) || 0;
    const { start, end, level } = request.query;
    if ((start != null) !== (end != null)) {
      return reply.status(400).send({ error: 'start and end must be provided together' });
    }
    if (start && end && (Number.isNaN(Date.parse(start)) || Number.isNaN(Date.parse(end)))) {
      return reply.status(400).send({ error: 'start and end must be valid ISO dates' });
    }
    return readFileLog(type, limit, offset, { start, end, level });
  });
};
