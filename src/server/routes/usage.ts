// Usage analytics routes — per-user and global usage stats
import type { FastifyPluginAsync } from 'fastify';
import { adminAuth } from '../middleware/admin-auth.js';
import { getStats, getUsageByUser, getTimeSeries } from '../db/repositories/request-log.js';

export const usageRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', adminAuth);

  // Global usage stats
  fastify.get('/stats', async (request) => {
    const { start, end } = request.query as { start?: string; end?: string };
    return getStats(start, end);
  });

  // Per-user usage summary
  fastify.get('/by-user', async (request) => {
    const { start, end } = request.query as { start?: string; end?: string };
    return getUsageByUser(start, end);
  });

  // Global time series
  fastify.get('/timeseries', async (request, reply) => {
    const { start, end, bucket, tz_offset } = request.query as {
      start: string;
      end: string;
      bucket?: string;
      tz_offset?: string;
    };

    if (!start || !end) {
      return reply.status(400).send({
        error: { message: 'start and end query parameters are required', type: 'invalid_request_error', code: 400 },
      });
    }

    const tzOffset = tz_offset ? parseInt(tz_offset, 10) : 0;
    const bucketSize = bucket === 'hour' ? 'hour' : 'day';
    return getTimeSeries(start, end, tzOffset, bucketSize);
  });

  // Per-user time series
  fastify.get('/by-user/:id/timeseries', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { start, end, bucket, tz_offset } = request.query as {
      start: string;
      end: string;
      bucket?: string;
      tz_offset?: string;
    };

    if (!start || !end) {
      return reply.status(400).send({
        error: { message: 'start and end query parameters are required', type: 'invalid_request_error', code: 400 },
      });
    }

    const tzOffset = tz_offset ? parseInt(tz_offset, 10) : 0;
    const bucketSize = bucket === 'hour' ? 'hour' : 'day';
    return getTimeSeries(start, end, tzOffset, bucketSize, id);
  });
};
