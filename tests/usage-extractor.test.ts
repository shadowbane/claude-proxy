import { describe, it, expect } from 'vitest';
import { extractUsage, normalizeTokens } from '../src/server/lib/usage-extractor.js';

// ── JSON (non-streaming) extraction ─────────────────

describe('extractUsage — JSON', () => {
  it('extracts usage from Anthropic JSON response', () => {
    const body = JSON.stringify({
      id: 'msg_123',
      type: 'message',
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_creation_input_tokens: 10,
        cache_read_input_tokens: 5,
      },
    });

    const usage = extractUsage(body, 'application/json');
    expect(usage).toEqual({
      input_tokens: 100,
      output_tokens: 50,
      cache_creation_input_tokens: 10,
      cache_read_input_tokens: 5,
    });
  });

  it('returns null for empty body', () => {
    expect(extractUsage('', 'application/json')).toBeNull();
  });

  it('returns null for JSON without usage', () => {
    const body = JSON.stringify({ id: 'msg_123', type: 'message' });
    expect(extractUsage(body, 'application/json')).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    expect(extractUsage('not json', 'application/json')).toBeNull();
  });
});

// ── SSE (streaming) extraction ──────────────────────

describe('extractUsage — SSE', () => {
  it('extracts usage from Anthropic streaming events', () => {
    const body = [
      'event: message_start',
      'data: {"type":"message_start","message":{"id":"msg_1","type":"message","usage":{"input_tokens":200,"cache_creation_input_tokens":20,"cache_read_input_tokens":15}}}',
      '',
      'event: content_block_start',
      'data: {"type":"content_block_start","index":0}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}',
      '',
      'event: message_delta',
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":75}}',
      '',
      'data: [DONE]',
    ].join('\n');

    const usage = extractUsage(body, 'text/event-stream');
    expect(usage).toEqual({
      input_tokens: 200,
      cache_creation_input_tokens: 20,
      cache_read_input_tokens: 15,
      output_tokens: 75,
    });
  });

  it('merges usage from multiple events', () => {
    const body = [
      'data: {"type":"message_start","message":{"usage":{"input_tokens":100}}}',
      'data: {"type":"message_delta","usage":{"output_tokens":50}}',
    ].join('\n');

    const usage = extractUsage(body, 'text/event-stream');
    expect(usage).toEqual({ input_tokens: 100, output_tokens: 50 });
  });

  it('detects SSE by content even with wrong content-type', () => {
    const body = 'data: {"type":"message_start","message":{"usage":{"input_tokens":42}}}\n';
    const usage = extractUsage(body, 'application/json');
    // Falls through JSON parse failure, tries SSE as fallback
    expect(usage).toEqual({ input_tokens: 42 });
  });

  it('skips [DONE] and invalid JSON lines', () => {
    const body = [
      'data: [DONE]',
      'data: not json',
      'data: {"type":"message_delta","usage":{"output_tokens":10}}',
    ].join('\n');

    const usage = extractUsage(body, 'text/event-stream');
    expect(usage).toEqual({ output_tokens: 10 });
  });

  it('returns null for empty SSE', () => {
    const body = 'event: ping\n\n';
    expect(extractUsage(body, 'text/event-stream')).toBeNull();
  });
});

// ── normalizeTokens ─────────────────────────────────

describe('normalizeTokens', () => {
  it('normalizes Anthropic field names', () => {
    const result = normalizeTokens({
      input_tokens: 100,
      output_tokens: 50,
      cache_creation_input_tokens: 10,
      cache_read_input_tokens: 5,
    });

    expect(result).toEqual({
      prompt: 100,
      completion: 50,
      cacheCreation: 10,
      cacheRead: 5,
    });
  });

  it('returns nulls for missing fields', () => {
    expect(normalizeTokens({})).toEqual({
      prompt: null,
      completion: null,
      cacheCreation: null,
      cacheRead: null,
    });
  });

  it('returns all nulls for null input', () => {
    expect(normalizeTokens(null)).toEqual({
      prompt: null,
      completion: null,
      cacheCreation: null,
      cacheRead: null,
    });
  });

  it('ignores non-finite numbers', () => {
    const result = normalizeTokens({
      input_tokens: Infinity,
      output_tokens: NaN,
      cache_creation_input_tokens: 'string' as unknown as number,
    });

    expect(result).toEqual({
      prompt: null,
      completion: null,
      cacheCreation: null,
      cacheRead: null,
    });
  });

  it('handles zero values correctly', () => {
    const result = normalizeTokens({
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    });

    expect(result).toEqual({
      prompt: 0,
      completion: 0,
      cacheCreation: 0,
      cacheRead: 0,
    });
  });
});
