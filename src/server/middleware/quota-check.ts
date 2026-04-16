// Quota check middleware — blocks proxy requests when daily token quota is exceeded
import type { FastifyRequest, FastifyReply } from 'fastify';
import { checkQuota } from '../db/repositories/quota.js';

export async function quotaCheck(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { userId } = request.proxyAuth!;
  const { allowed, status } = checkQuota(userId);

  if (!allowed) {
    return reply.status(429).send({
      error: {
        message: `Daily token quota exceeded. Used ${status.tokens_used.toLocaleString()} of ${status.quota_limit!.toLocaleString()} tokens. Resets at ${status.window_end} UTC.`,
        type: 'quota_exceeded',
      },
      quota: status,
    });
  }
}
