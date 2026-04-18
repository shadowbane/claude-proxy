// Proxy routes — forward Anthropic-compatible requests to MiMo-v2 upstream.
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { config } from '../config.js';
import { proxyAuth } from '../middleware/proxy-auth.js';
import { quotaCheck } from '../middleware/quota-check.js';
import { create as createRequestLog } from '../db/repositories/request-log.js';
import { getDecrypted } from '../db/repositories/settings.js';
import { extractUsage, normalizeTokens } from '../lib/usage-extractor.js';
import { estimateCredits } from '../lib/credit-calculator.js';
import { findMalformedToolUse, sanitizeMessages } from '../lib/request-diagnostics.js';

function getUpstreamApiKey(): string {
  const dbKey = getDecrypted('upstream_api_key', config.tokenEncryptionKey);
  return dbKey || config.upstreamApiKey;
}

// Cap the per-request tee buffer used for usage extraction.
const USAGE_BUFFER_MAX = 256 * 1024;

export const proxyRoutes: FastifyPluginAsync = async (fastify) => {
  // Liveness probe — no auth required (Claude Code sends HEAD before POST)
  fastify.head('/messages', async (_req, reply) => reply.status(200).send());

  // Proxied messages — auth required
  fastify.post(
    '/messages',
    { preHandler: [proxyAuth, quotaCheck], bodyLimit: 10 * 1024 * 1024 },
    async (request: FastifyRequest, reply: FastifyReply) => {
      await forwardMessages(request, reply, fastify);
    },
  );
};

async function forwardMessages(
  request: FastifyRequest,
  reply: FastifyReply,
  fastify: import('fastify').FastifyInstance,
): Promise<void> {
  const { userId, tokenId } = request.proxyAuth!;
  const clientIp = request.ip;
  const body = (request.body ?? {}) as Record<string, unknown>;

  // Extract model from request body for logging
  const model = typeof body.model === 'string' ? body.model : 'unknown';

  // Debug: log the full inbound request body for diagnosing prompt_token spikes
  if (config.logDetailedRequest.toLowerCase() === 'true') {
    fastify.log.debug(
        {userId, model, requestBody: body},
        'Inbound proxy request — full body',
    );
  }

  // Defensive: sanitize malformed tool_use blocks before forwarding
  let forwardBody = body;
  const sanitized = sanitizeMessages(body);
  if (sanitized.removedToolUseIds.length > 0 || sanitized.droppedMessageIndices.length > 0) {
    fastify.log.warn(
      {
        removedToolUseIds: sanitized.removedToolUseIds,
        removedToolResultIds: sanitized.removedToolResultIds,
        droppedMessageIndices: sanitized.droppedMessageIndices,
      },
      'Sanitized malformed tool_use blocks from request history',
    );
    forwardBody = sanitized.body as Record<string, unknown>;
  }

  // Preserve client query string (e.g. Claude Code sends ?beta=true)
  const queryIdx = request.url.indexOf('?');
  const queryString = queryIdx >= 0 ? request.url.slice(queryIdx) : '';

  // Build upstream headers — forward anthropic-version and anthropic-beta
  const upstreamHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${getUpstreamApiKey()}`,
    'Accept': (request.headers.accept as string) ?? '*/*',
  };
  const anthropicVersion = request.headers['anthropic-version'];
  if (typeof anthropicVersion === 'string') {
    upstreamHeaders['anthropic-version'] = anthropicVersion;
  }
  const anthropicBeta = request.headers['anthropic-beta'];
  if (typeof anthropicBeta === 'string') {
    upstreamHeaders['anthropic-beta'] = anthropicBeta;
  }

  const startTime = performance.now();
  const endpoint = '/v1/messages';

  try {
    const upstream = await fetch(
      `${config.upstreamBaseUrl}${endpoint}${queryString}`,
      {
        method: 'POST',
        headers: upstreamHeaders,
        body: JSON.stringify(forwardBody),
        signal: AbortSignal.timeout(config.requestTimeoutMs),
      },
    );

    if (!upstream.ok) {
      const latencyMs = Math.round(performance.now() - startTime);
      const errText = await upstream.text();
      const errorMessage = `Upstream ${upstream.status}: ${errText.slice(0, 500)}`;

      createRequestLog({
        user_id: userId,
        token_id: tokenId,
        model,
        endpoint,
        prompt_tokens: 0,
        completion_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        estimated_credits: null,
        latency_ms: latencyMs,
        status: 'error',
        error_message: errorMessage,
        client_ip: clientIp,
      });

      // Diagnose tool_use schema bugs on 400 responses
      if (upstream.status === 400 && /tool_use/i.test(errText)) {
        const problems = findMalformedToolUse(forwardBody);
        if (problems.length > 0) {
          fastify.log.warn(
            {
              upstreamStatus: upstream.status,
              problems: problems.map((p) => ({
                messageIndex: p.messageIndex,
                role: p.role,
                blockIndex: p.blockIndex,
                problem: p.problem,
              })),
            },
            'Malformed tool_use block(s) in client request',
          );
        }
      }

      // Forward the upstream error response to the client
      reply.status(upstream.status).send(errText);
      return;
    }

    // Success — stream response, extract usage, then write a single log row.
    // If streaming throws (client disconnect, network error), the exception
    // propagates to the outer catch which writes an error log — no early
    // INSERT means no stale zero-token row to clean up.
    const contentType = upstream.headers.get('content-type') ?? 'application/json';
    reply.raw.statusCode = upstream.status;
    reply.raw.setHeader('content-type', contentType);
    const cacheControl = upstream.headers.get('cache-control');
    if (cacheControl) reply.raw.setHeader('cache-control', cacheControl);

    let promptTokens = 0;
    let completionTokens = 0;
    let cacheCreationTokens = 0;
    let cacheReadTokens = 0;

    if (upstream.body) {
      // Stream response while teeing chunks for usage extraction
      const reader = upstream.body.getReader();
      const teeChunks: Buffer[] = [];
      let teeSize = 0;
      let teeOverflow = false;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            reply.raw.write(value);
            if (!teeOverflow) {
              if (teeSize + value.byteLength <= USAGE_BUFFER_MAX) {
                teeChunks.push(Buffer.from(value));
                teeSize += value.byteLength;
              } else {
                teeOverflow = true;
              }
            }
          }
        }
      } finally {
        reply.raw.end();
      }

      // Best-effort usage extraction
      try {
        if (!teeOverflow && teeChunks.length > 0) {
          const bodyText = Buffer.concat(teeChunks).toString('utf8');
          const usage = extractUsage(bodyText, contentType);
          if (usage) {
            const { prompt, completion, cacheCreation, cacheRead } = normalizeTokens(usage);
            promptTokens = prompt ?? 0;
            completionTokens = completion ?? 0;
            cacheCreationTokens = cacheCreation ?? 0;
            cacheReadTokens = cacheRead ?? 0;

            if (config.logDetailedRequest.toLowerCase() === 'true') {
              fastify.log.debug(
                  {usage, model, userId, endpoint},
                  'Upstream usage — prompt_tokens=%d, completion_tokens=%d',
                  prompt ?? 0,
                  completion ?? 0,
              );
            }
          }
        } else if (teeOverflow) {
          fastify.log.debug(
            { model, userId, endpoint, bufferLimit: USAGE_BUFFER_MAX },
            'Upstream usage skipped (response exceeded buffer cap)',
          );
        }
      } catch (err) {
        fastify.log.debug({ err }, 'Usage extraction failed');
      }
    } else {
      reply.raw.end();
    }

    const latencyMs = Math.round(performance.now() - startTime);
    createRequestLog({
      user_id: userId,
      token_id: tokenId,
      model,
      endpoint,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      cache_creation_input_tokens: cacheCreationTokens,
      cache_read_input_tokens: cacheReadTokens,
      estimated_credits: estimateCredits({
        model,
        promptTokens,
        completionTokens,
        cacheCreationTokens,
        cacheReadTokens,
      }),
      latency_ms: latencyMs,
      status: 'success',
      error_message: null,
      client_ip: clientIp,
    });
  } catch (err) {
    const latencyMs = Math.round(performance.now() - startTime);
    const errorMessage = err instanceof Error ? err.message : String(err);

    createRequestLog({
      user_id: userId,
      token_id: tokenId,
      model,
      endpoint,
      prompt_tokens: 0,
      completion_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      estimated_credits: null,
      latency_ms: latencyMs,
      status: 'error',
      error_message: errorMessage,
      client_ip: clientIp,
    });

    fastify.log.error({ err, userId, endpoint }, 'Proxy request failed');
    reply.status(502).send({
      error: { message: errorMessage, type: 'upstream_error' },
    });
  }
}
