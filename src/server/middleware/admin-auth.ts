// Admin auth middleware — JWT verification for /api/* routes
import type { FastifyRequest, FastifyReply } from 'fastify';

/**
 * Fastify preHandler hook that verifies JWT from httpOnly cookie.
 * Attaches decoded admin payload to request.user.
 */
export async function adminAuth(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  try {
    await request.jwtVerify();
  } catch {
    return reply.status(401).send({
      error: { message: 'Unauthorized', type: 'authentication_error', code: 401 },
    });
  }
}
