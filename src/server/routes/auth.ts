// Auth routes — login, logout, me, change-password
import type { FastifyPluginAsync } from 'fastify';
import { getAdminByUsername, getAdminById, updateAdminPassword } from '../db/repositories/admin.js';
import { verifyPassword, hashPassword } from '../lib/crypto.js';
import { adminAuth } from '../middleware/admin-auth.js';

interface LoginBody {
  username: string;
  password: string;
}

interface ChangePasswordBody {
  current_password: string;
  new_password: string;
}

export const authRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /api/auth/login — validate credentials, issue JWT + httpOnly cookie
  fastify.post<{ Body: LoginBody }>('/login', async (request, reply) => {
    const { username, password } = request.body;

    if (!username || !password) {
      return reply.status(400).send({
        error: { message: 'Username and password are required', type: 'invalid_request_error', code: 400 },
      });
    }

    const admin = getAdminByUsername(username);
    if (!admin) {
      return reply.status(401).send({
        error: { message: 'Invalid credentials', type: 'authentication_error', code: 401 },
      });
    }

    const valid = await verifyPassword(password, admin.password_hash);
    if (!valid) {
      return reply.status(401).send({
        error: { message: 'Invalid credentials', type: 'authentication_error', code: 401 },
      });
    }

    const token = fastify.jwt.sign(
      { id: admin.id, username: admin.username },
      { expiresIn: '24h' },
    );

    reply
      .setCookie('token', token, {
        path: '/',
        httpOnly: true,
        sameSite: 'strict',
        secure: !fastify.config?.isDev,
        maxAge: 60 * 60 * 24, // 24 hours
      })
      .send({
        id: admin.id,
        username: admin.username,
      });
  });

  // POST /api/auth/logout — clear cookie
  fastify.post('/logout', async (_request, reply) => {
    reply
      .clearCookie('token', { path: '/' })
      .send({ message: 'Logged out' });
  });

  // GET /api/auth/me — return current admin (requires auth)
  fastify.get('/me', { preHandler: adminAuth }, async (request, reply) => {
    const payload = request.user as { id: string; username: string };
    const admin = getAdminById(payload.id);

    if (!admin) {
      return reply.status(404).send({
        error: { message: 'Admin not found', type: 'not_found_error', code: 404 },
      });
    }

    return {
      id: admin.id,
      username: admin.username,
      created_at: admin.created_at,
    };
  });

  // POST /api/auth/change-password — update password (requires auth)
  fastify.post<{ Body: ChangePasswordBody }>(
    '/change-password',
    { preHandler: adminAuth },
    async (request, reply) => {
      const { current_password, new_password } = request.body;
      const payload = request.user as { id: string };

      if (!current_password || !new_password) {
        return reply.status(400).send({
          error: { message: 'Current and new password are required', type: 'invalid_request_error', code: 400 },
        });
      }

      if (new_password.length < 6) {
        return reply.status(400).send({
          error: { message: 'New password must be at least 6 characters', type: 'invalid_request_error', code: 400 },
        });
      }

      const admin = getAdminById(payload.id);
      if (!admin) {
        return reply.status(404).send({
          error: { message: 'Admin not found', type: 'not_found_error', code: 404 },
        });
      }

      const valid = await verifyPassword(current_password, admin.password_hash);
      if (!valid) {
        return reply.status(401).send({
          error: { message: 'Current password is incorrect', type: 'authentication_error', code: 401 },
        });
      }

      const newHash = await hashPassword(new_password);
      updateAdminPassword(payload.id, newHash);

      return { message: 'Password changed successfully' };
    },
  );
};
