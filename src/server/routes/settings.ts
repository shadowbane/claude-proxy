// Settings routes — admin CRUD for key-value configuration
import type { FastifyPluginAsync } from 'fastify';
import { adminAuth } from '../middleware/admin-auth.js';
import { config } from '../config.js';
import { getAll, upsert, remove, getDecrypted, upsertEncrypted } from '../db/repositories/settings.js';
import { runLogCleanup } from '../lib/log-cleaner.js';

export const settingsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', adminAuth);

  // Get all settings as a key-value object (excludes encrypted settings)
  fastify.get('/settings', async () => {
    const all = getAll();
    // Don't expose encrypted blobs in the generic endpoint
    delete all['upstream_api_key'];
    return all;
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

      // Validate quota_reset_time format
      if (key === 'quota_reset_time') {
        if (!/^\d{2}:\d{2}$/.test(value)) {
          return reply.status(400).send({
            error: { message: 'quota_reset_time must be in HH:MM format', type: 'invalid_request_error', code: 400 },
          });
        }
        const [h, m] = value.split(':').map(Number);
        if (h < 0 || h > 23 || m < 0 || m > 59) {
          return reply.status(400).send({
            error: { message: 'quota_reset_time must have valid hours (00-23) and minutes (00-59)', type: 'invalid_request_error', code: 400 },
          });
        }
      }

      // Validate quota_default_limit (empty string = remove)
      if (key === 'quota_default_limit') {
        if (value === '') {
          remove(key);
          continue;
        }
        const parsed = parseInt(value, 10);
        if (isNaN(parsed) || parsed < 0 || !Number.isInteger(parsed) || String(parsed) !== value) {
          return reply.status(400).send({
            error: { message: 'quota_default_limit must be a non-negative integer', type: 'invalid_request_error', code: 400 },
          });
        }
      }

      upsert(key, value);
    }

    return getAll();
  });

  // ── Upstream API Key (encrypted) ──────────────

  // Get upstream API key status
  fastify.get('/settings/upstream-api-key', async () => {
    const dbKey = getDecrypted('upstream_api_key', config.tokenEncryptionKey);
    const envKey = config.upstreamApiKey;

    if (dbKey) {
      return { configured: true, source: 'database' as const, masked: mask(dbKey) };
    }
    if (envKey) {
      return { configured: true, source: 'env' as const, masked: mask(envKey) };
    }
    return { configured: false, source: 'none' as const, masked: null };
  });

  // Set upstream API key (stored encrypted in DB)
  fastify.put('/settings/upstream-api-key', async (request, reply) => {
    const body = request.body as { value?: string } | null;
    const value = body?.value;

    if (!value || typeof value !== 'string' || value.trim().length === 0) {
      return reply.status(400).send({
        error: { message: 'value is required and must be a non-empty string', type: 'invalid_request_error', code: 400 },
      });
    }

    upsertEncrypted('upstream_api_key', value.trim(), config.tokenEncryptionKey);

    const masked = mask(value.trim());
    return { configured: true, source: 'database' as const, masked };
  });

  // Delete upstream API key from DB (falls back to env)
  fastify.delete('/settings/upstream-api-key', async () => {
    remove('upstream_api_key');

    const envKey = config.upstreamApiKey;
    if (envKey) {
      return { configured: true, source: 'env' as const, masked: mask(envKey) };
    }
    return { configured: false, source: 'none' as const, masked: null };
  });

  // ── Log Cleanup ──────────────────────────────────

  // Manually trigger log cleanup
  fastify.post('/settings/log-cleanup', async () => {
    return runLogCleanup(true);
  });
};

function mask(key: string): string {
  if (key.length <= 8) return '****' + key.slice(-4);
  return key.slice(0, 4) + '****' + key.slice(-4);
}
