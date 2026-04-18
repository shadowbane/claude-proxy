// Credit check middleware — blocks proxy requests when monthly mimo-v2-pro
// credit limit is exceeded. Runs independently of the daily quota check.
import type { FastifyRequest, FastifyReply } from 'fastify';
import { checkCreditLimit } from '../db/repositories/credit.js';

export async function creditCheck(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { userId } = request.proxyAuth!;
  const { allowed, status } = checkCreditLimit(userId);

  if (!allowed) {
    return reply.status(429).send({
      error: {
        message: `Monthly credit limit exceeded. Used ${status.credits_used.toLocaleString()} of ${status.credit_limit!.toLocaleString()} credits. Resets at ${status.window_end} UTC.`,
        type: 'credit_limit_exceeded',
      },
      credits: status,
    });
  }
}
