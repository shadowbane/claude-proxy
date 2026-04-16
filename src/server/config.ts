// Server configuration — reads from environment variables
import 'dotenv/config';

function env(key: string, fallback?: string): string {
  const value = process.env[key] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required env var: ${key}`);
  }
  return value;
}

function envInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined) return fallback;
  const parsed = parseInt(raw, 10);
  if (Number.isNaN(parsed)) throw new Error(`Invalid integer env var: ${key}`);
  return parsed;
}

const nodeEnv = env('NODE_ENV', 'development');

export const config = {
  port: envInt('PORT', 3000),
  host: env('HOST', '0.0.0.0'),
  nodeEnv,

  dbPath: env('DB_PATH', './data/proxy.db'),
  logLevel: env('LOG_LEVEL', 'info'),
  logDir: env('LOG_DIR', './data/logs'),
  logDetailedRequest: env('LOG_DETAILED_REQUEST', 'false'),

  // Upstream MiMo-v2
  upstreamBaseUrl: env('UPSTREAM_BASE_URL').replace(/\/+$/, ''),
  upstreamApiKey: env('UPSTREAM_API_KEY', ''),

  // Admin auth
  jwtSecret: env('JWT_SECRET'),
  adminUsername: env('ADMIN_USERNAME', 'admin'),
  adminPassword: env('ADMIN_PASSWORD'),

  // Token encryption
  tokenEncryptionKey: env('TOKEN_ENCRYPTION_KEY'),

  // TLS (optional)
  tlsCertPath: process.env['TLS_CERT_PATH'],
  tlsKeyPath: process.env['TLS_KEY_PATH'],

  // Rate limiting
  rateLimitMax: envInt('RATE_LIMIT_MAX', 120),
  rateLimitWindowMs: envInt('RATE_LIMIT_WINDOW_MS', 60_000),

  // Request
  requestTimeoutMs: envInt('REQUEST_TIMEOUT_MS', 300_000),

  isDev: nodeEnv === 'development',
  isProd: nodeEnv === 'production',
} as const;
