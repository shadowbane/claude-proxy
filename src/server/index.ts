// ── Fastify server entry point ──────────────────────
import Fastify from 'fastify';
import cors from '@fastify/cors';
import compress from '@fastify/compress';
import fastifyJwt from '@fastify/jwt';
import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { getDb, closeDb, seedAdmin } from './db/connection.js';
import { errorHandler } from './middleware/error-handler.js';
import { createRateLimiter } from './middleware/rate-limit.js';
import { authRoutes } from './routes/auth.js';
import { userRoutes } from './routes/users.js';
import { tokenRoutes } from './routes/tokens.js';
import { proxyRoutes } from './routes/proxy.js';
import { usageRoutes } from './routes/usage.js';
import { requestLogRoutes } from './routes/request-logs.js';
import { settingsRoutes } from './routes/settings.js';
import { startLogCleanupSchedule, stopLogCleanupSchedule } from './lib/log-cleaner.js';
import { flushPendingTouches } from './db/repositories/api-token.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Logger setup ────────────────────────────────────
mkdirSync(config.logDir, { recursive: true });

const appLogPath = path.join(config.logDir, 'app.log');
const errorLogPath = path.join(config.logDir, 'error.log');

async function main() {
  const fastify = Fastify({
    disableRequestLogging: true,
    logger: {
      level: config.logLevel,
      transport: config.isDev
        ? {
            targets: [
              { target: 'pino-pretty', level: config.logLevel, options: { colorize: true } },
              { target: 'pino/file', level: config.logLevel, options: { destination: appLogPath } },
              { target: 'pino/file', level: 'error', options: { destination: errorLogPath } },
            ],
          }
        : {
            targets: [
              { target: 'pino/file', level: config.logLevel, options: { destination: 1 } },
              { target: 'pino/file', level: config.logLevel, options: { destination: appLogPath } },
              { target: 'pino/file', level: 'error', options: { destination: errorLogPath } },
            ],
          },
    },
  });

  fastify.log.info(`Log files: ${appLogPath}, ${errorLogPath}`);

  // Request lifecycle logs at debug level
  fastify.addHook('onRequest', (req, _reply, done) => {
    req.log.debug({ req }, 'incoming request');
    done();
  });
  fastify.addHook('onResponse', (req, reply, done) => {
    req.log.debug({ res: reply, responseTime: reply.elapsedTime }, 'request completed');
    done();
  });

  // Error handler
  fastify.setErrorHandler(errorHandler);

  // Plugins
  await fastify.register(cors);
  await fastify.register(compress);
  await fastify.register(fastifyJwt, {
    secret: config.jwtSecret,
    cookie: { cookieName: 'token', signed: false },
  });
  await fastify.register(fastifyCookie);
  await fastify.register(createRateLimiter());

  // Initialize database and seed admin
  getDb();
  await seedAdmin();
  fastify.log.info(`Database initialized at ${config.dbPath}`);

  // Routes
  await fastify.register(authRoutes, { prefix: '/api/auth' });
  await fastify.register(userRoutes, { prefix: '/api/users' });
  await fastify.register(tokenRoutes, { prefix: '/api' });
  await fastify.register(proxyRoutes, { prefix: '/v1' });
  await fastify.register(usageRoutes, { prefix: '/api/usage' });
  await fastify.register(requestLogRoutes, { prefix: '/api' });
  await fastify.register(settingsRoutes, { prefix: '/api' });

  // Health check
  fastify.get('/api/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  // In production, serve the Vite build as static files
  if (config.isProd) {
    await fastify.register(fastifyStatic, {
      root: path.join(__dirname, '../web'),
      prefix: '/',
      wildcard: false,
    });
    // SPA fallback
    fastify.setNotFoundHandler((request, reply) => {
      if (!request.url.startsWith('/api/') && !request.url.startsWith('/v1/')) {
        return reply.sendFile('index.html');
      }
      return reply.status(404).send({ error: 'Not found' });
    });
  }

  // Start log cleanup scheduler
  startLogCleanupSchedule(fastify.log);

  // Graceful shutdown
  const shutdown = async () => {
    fastify.log.info('Shutting down...');
    stopLogCleanupSchedule();
    flushPendingTouches();
    await fastify.close();
    closeDb();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Start
  await fastify.listen({ port: config.port, host: config.host });
  fastify.log.info(`Server listening on http://${config.host}:${config.port}`);
}

main().catch((err) => {
  console.error('Fatal error starting server:', err);
  process.exit(1);
});
