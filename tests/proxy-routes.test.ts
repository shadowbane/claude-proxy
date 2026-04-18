import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { createTestDb, seedTestAdmin, buildTestApp, loginAs, createTestUserWithToken } from './helpers.js';
import type { FastifyInstance } from 'fastify';

let db: Database.Database;
let app: FastifyInstance;
let cookie: string;
let rawToken: string;
let userId: string;

beforeEach(async () => {
  db = createTestDb();
  await seedTestAdmin(db);
  app = await buildTestApp(db);
  cookie = await loginAs(app, 'admin', 'testpass123');
  const testData = await createTestUserWithToken(app, cookie);
  rawToken = testData.rawToken;
  userId = testData.userId;
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await app.close();
  db.close();
  vi.restoreAllMocks();
});

function makeProxyRequest(body = { model: 'test', messages: [{ role: 'user', content: 'Hi' }], max_tokens: 10 }) {
  return app.inject({
    method: 'POST',
    url: '/v1/messages',
    headers: {
      authorization: `Bearer ${rawToken}`,
      'anthropic-version': '2023-06-01',
    },
    payload: body,
  });
}

// ── HEAD /v1/messages ───────────────────────────────

describe('HEAD /v1/messages', () => {
  it('returns 200 without auth', async () => {
    const res = await app.inject({ method: 'HEAD', url: '/v1/messages' });
    expect(res.statusCode).toBe(200);
  });
});

// ── POST /v1/messages — JSON response ───────────────

describe('POST /v1/messages — JSON', () => {
  it('proxies JSON response from upstream', async () => {
    const upstreamBody = JSON.stringify({
      id: 'msg_123',
      type: 'message',
      content: [{ type: 'text', text: 'Hello!' }],
      usage: { input_tokens: 10, output_tokens: 5 },
    });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(upstreamBody, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ));

    const res = await makeProxyRequest();
    expect(res.statusCode).toBe(200);

    // Verify the response body is forwarded
    const body = res.body;
    expect(body).toContain('msg_123');
    expect(body).toContain('Hello!');
  });

  it('logs successful request with usage tokens', async () => {
    const upstreamBody = JSON.stringify({
      id: 'msg_456',
      type: 'message',
      usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 10, cache_read_input_tokens: 5 },
    });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(upstreamBody, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ));

    await makeProxyRequest();

    // Check request log was created and tokens updated
    const log = db.prepare('SELECT * FROM request_logs ORDER BY id DESC LIMIT 1').get() as {
      user_id: string;
      status: string;
      prompt_tokens: number;
      completion_tokens: number;
      cache_creation_input_tokens: number;
      cache_read_input_tokens: number;
      model: string;
    };
    expect(log.user_id).toBe(userId);
    expect(log.status).toBe('success');
    expect(log.prompt_tokens).toBe(100);
    expect(log.completion_tokens).toBe(50);
    expect(log.cache_creation_input_tokens).toBe(10);
    expect(log.cache_read_input_tokens).toBe(5);
    expect(log.model).toBe('test');
  });

  it('stores NULL estimated_credits for non-mimo-v2-pro models', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'msg_x',
          type: 'message',
          usage: { input_tokens: 100, output_tokens: 50 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    ));

    await makeProxyRequest({ model: 'some-other-model', messages: [{ role: 'user', content: 'Hi' }], max_tokens: 10 });

    const log = db.prepare('SELECT estimated_credits FROM request_logs ORDER BY id DESC LIMIT 1').get() as {
      estimated_credits: number | null;
    };
    expect(log.estimated_credits).toBeNull();
  });

  it('stores estimated_credits (2× total) for mimo-v2-pro', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'msg_pro',
          type: 'message',
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_creation_input_tokens: 10,
            cache_read_input_tokens: 1000,
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    ));

    await makeProxyRequest({ model: 'mimo-v2-pro', messages: [{ role: 'user', content: 'Hi' }], max_tokens: 10 });

    const log = db.prepare('SELECT estimated_credits FROM request_logs ORDER BY id DESC LIMIT 1').get() as {
      estimated_credits: number | null;
    };
    expect(log.estimated_credits).toBe((100 + 50 + 10 + 1000) * 2);
  });

  it('forwards anthropic-version and anthropic-beta headers', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    vi.stubGlobal('fetch', mockFetch);

    await app.inject({
      method: 'POST',
      url: '/v1/messages',
      headers: {
        authorization: `Bearer ${rawToken}`,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'messages-2024-12-19',
      },
      payload: { model: 'test', messages: [{ role: 'user', content: 'Hi' }], max_tokens: 10 },
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, fetchOpts] = mockFetch.mock.calls[0];
    expect(fetchOpts.headers['anthropic-version']).toBe('2023-06-01');
    expect(fetchOpts.headers['anthropic-beta']).toBe('messages-2024-12-19');
  });

  it('preserves query string', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    vi.stubGlobal('fetch', mockFetch);

    await app.inject({
      method: 'POST',
      url: '/v1/messages?beta=true',
      headers: { authorization: `Bearer ${rawToken}` },
      payload: { model: 'test', messages: [{ role: 'user', content: 'Hi' }], max_tokens: 10 },
    });

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('?beta=true');
  });

  it('replaces Authorization with upstream key', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    vi.stubGlobal('fetch', mockFetch);

    await makeProxyRequest();

    const [, fetchOpts] = mockFetch.mock.calls[0];
    // Should be the upstream key from test setup, not the client token
    expect(fetchOpts.headers['Authorization']).toBe('Bearer sk-test-key');
    expect(fetchOpts.headers['Authorization']).not.toContain(rawToken);
  });
});

// ── POST /v1/messages — SSE streaming ───────────────

describe('POST /v1/messages — streaming', () => {
  it('proxies SSE stream and extracts usage', async () => {
    const sseBody = [
      'event: message_start',
      'data: {"type":"message_start","message":{"id":"msg_stream","usage":{"input_tokens":200,"cache_creation_input_tokens":20}}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}',
      '',
      'event: message_delta',
      'data: {"type":"message_delta","usage":{"output_tokens":75}}',
      '',
      'data: [DONE]',
    ].join('\n');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(sseBody, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }),
    ));

    const res = await makeProxyRequest({ model: 'stream-test', messages: [{ role: 'user', content: 'Hi' }], max_tokens: 10, stream: true });
    expect(res.statusCode).toBe(200);

    // Verify usage was extracted and saved
    const log = db.prepare('SELECT * FROM request_logs ORDER BY id DESC LIMIT 1').get() as {
      prompt_tokens: number;
      completion_tokens: number;
      cache_creation_input_tokens: number;
    };
    expect(log.prompt_tokens).toBe(200);
    expect(log.completion_tokens).toBe(75);
    expect(log.cache_creation_input_tokens).toBe(20);
  });
});

// ── Error handling ──────────────────────────────────

describe('POST /v1/messages — errors', () => {
  it('logs and forwards upstream error response', async () => {
    const errorBody = JSON.stringify({ error: { message: 'Invalid model', type: 'invalid_request' } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(errorBody, { status: 400, headers: { 'content-type': 'application/json' } }),
    ));

    const res = await makeProxyRequest();
    expect(res.statusCode).toBe(400);

    // Verify error was logged
    const log = db.prepare('SELECT * FROM request_logs ORDER BY id DESC LIMIT 1').get() as {
      status: string;
      error_message: string;
    };
    expect(log.status).toBe('error');
    expect(log.error_message).toContain('Upstream 400');
  });

  it('returns 502 when fetch throws (network error)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    const res = await makeProxyRequest();
    expect(res.statusCode).toBe(502);
    expect(res.json().error.type).toBe('upstream_error');

    // Verify error log was created
    const log = db.prepare('SELECT * FROM request_logs ORDER BY id DESC LIMIT 1').get() as {
      status: string;
      error_message: string;
    };
    expect(log.status).toBe('error');
    expect(log.error_message).toContain('ECONNREFUSED');
  });
});
