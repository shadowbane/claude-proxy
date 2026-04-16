// Settings routes — admin CRUD for key-value configuration
import type { FastifyPluginAsync } from 'fastify';
import { adminAuth } from '../middleware/admin-auth.js';
import { getAll, upsert } from '../db/repositories/settings.js';

export const settingsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', adminAuth);

  // Get all settings as a key-value object
  fastify.get('/settings', async () => {
    return getAll();
  });

  // Update settings — accepts an object of key-value pairs
  fastify.put('/settings', async (request, reply) => {
    const body = request.body as Record<string, string> | null;

    if (!body || typeof body !== 'object') {
      return reply.status(400).send({
        error: { message: 'Request body must be a JSON object of key-value pairs', type: 'invalid_request_error', code: 400 },
      });
    }

    for (const [key, value] of Object.entries(body)) {
      if (typeof value !== 'string') {
        return reply.status(400).send({
          error: { message: `Value for "${key}" must be a string`, type: 'invalid_request_error', code: 400 },
        });
      }
      upsert(key, value);
    }

    return getAll();
  });
};
