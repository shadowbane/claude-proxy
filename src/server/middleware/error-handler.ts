// Global error handler — structured JSON responses for all errors
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config.js';

function resolveStatusCode(error: FastifyError): number {
  if (error.statusCode && error.statusCode >= 400 && error.statusCode < 600) {
    return error.statusCode;
  }

  const msg = error.message.toLowerCase();
  if (msg.includes('not found')) return 404;
  if (msg.includes('invalid') || msg.includes('unauthorized')) return 401;
  if (msg.includes('forbidden')) return 403;
  if (msg.includes('rate limit')) return 429;
  if (msg.includes('timeout')) return 504;

  return 500;
}

function resolveErrorType(statusCode: number): string {
  switch (statusCode) {
    case 400: return 'invalid_request_error';
    case 401: return 'authentication_error';
    case 403: return 'permission_error';
    case 404: return 'not_found_error';
    case 429: return 'rate_limit_error';
    case 504: return 'timeout_error';
    default:  return 'internal_server_error';
  }
}

export function errorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  const statusCode = resolveStatusCode(error);
  const errorType = resolveErrorType(statusCode);

  const message =
    statusCode === 500 && config.isProd
      ? 'Internal Server Error'
      : error.message;

  if (statusCode >= 500) {
    request.log.error({ err: error, req: request.url }, error.message);
  } else {
    request.log.warn({ statusCode, url: request.url }, error.message);
  }

  const body: Record<string, unknown> = {
    error: {
      message,
      type: errorType,
      code: statusCode,
    },
  };

  if (config.isDev && error.stack) {
    (body.error as Record<string, unknown>).stack = error.stack;
  }

  reply.status(statusCode).send(body);
}
