import { describe, it, expect } from 'vitest';
import { findMalformedToolUse, sanitizeMessages } from '../src/server/lib/request-diagnostics.js';

// ── findMalformedToolUse ────────────────────────────

describe('findMalformedToolUse', () => {
  it('returns empty array for valid messages', () => {
    const body = {
      messages: [
        { role: 'user', content: 'Hello' },
        {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'tool_1', name: 'read_file', input: { path: '/etc' } },
          ],
        },
      ],
    };
    expect(findMalformedToolUse(body)).toEqual([]);
  });

  it('detects missing name', () => {
    const body = {
      messages: [
        {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'tool_1', name: '', input: {} },
          ],
        },
      ],
    };
    const problems = findMalformedToolUse(body);
    expect(problems).toHaveLength(1);
    expect(problems[0].problem).toContain("missing 'name'");
    expect(problems[0].messageIndex).toBe(0);
    expect(problems[0].blockIndex).toBe(0);
  });

  it('detects missing id', () => {
    const body = {
      messages: [
        {
          role: 'assistant',
          content: [
            { type: 'tool_use', name: 'read_file', input: {} },
          ],
        },
      ],
    };
    const problems = findMalformedToolUse(body);
    expect(problems).toHaveLength(1);
    expect(problems[0].problem).toContain("missing 'id'");
  });

  it('detects missing input', () => {
    const body = {
      messages: [
        {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'tool_1', name: 'read_file' },
          ],
        },
      ],
    };
    const problems = findMalformedToolUse(body);
    expect(problems).toHaveLength(1);
    expect(problems[0].problem).toContain("missing 'input'");
  });

  it('detects multiple problems in one block', () => {
    const body = {
      messages: [
        {
          role: 'assistant',
          content: [
            { type: 'tool_use' }, // missing name, id, and input
          ],
        },
      ],
    };
    const problems = findMalformedToolUse(body);
    expect(problems).toHaveLength(1);
    expect(problems[0].problem).toContain("missing 'name'");
    expect(problems[0].problem).toContain("missing 'id'");
    expect(problems[0].problem).toContain("missing 'input'");
  });

  it('returns empty for non-object body', () => {
    expect(findMalformedToolUse(null)).toEqual([]);
    expect(findMalformedToolUse('string')).toEqual([]);
  });

  it('ignores non-tool_use blocks', () => {
    const body = {
      messages: [
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'Hello' }],
        },
      ],
    };
    expect(findMalformedToolUse(body)).toEqual([]);
  });

  it('handles string content (not array)', () => {
    const body = {
      messages: [{ role: 'user', content: 'just a string' }],
    };
    expect(findMalformedToolUse(body)).toEqual([]);
  });
});

// ── sanitizeMessages ────────────────────────────────

describe('sanitizeMessages', () => {
  it('returns body unchanged when no malformed blocks', () => {
    const body = {
      model: 'test',
      messages: [
        { role: 'user', content: 'Hello' },
        {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'tool_1', name: 'read_file', input: { path: '/' } },
          ],
        },
      ],
    };
    const result = sanitizeMessages(body);
    expect(result.removedToolUseIds).toEqual([]);
    expect(result.removedToolResultIds).toEqual([]);
    expect(result.droppedMessageIndices).toEqual([]);
    expect(result.body).toBe(body); // same reference when no changes
  });

  it('strips malformed tool_use and matching tool_result', () => {
    const body = {
      model: 'test',
      messages: [
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Let me help' },
            { type: 'tool_use', id: 'bad_tool', name: '', input: {} },
          ],
        },
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'bad_tool', content: 'result' },
          ],
        },
      ],
    };

    const result = sanitizeMessages(body);
    expect(result.removedToolUseIds).toEqual(['bad_tool']);
    expect(result.removedToolResultIds).toEqual(['bad_tool']);

    const newBody = result.body as { messages: Array<{ content: unknown[] }> };
    // First message should keep the text block
    expect(newBody.messages[0].content).toHaveLength(1);
    expect((newBody.messages[0].content[0] as { type: string }).type).toBe('text');
  });

  it('drops empty messages after stripping', () => {
    const body = {
      model: 'test',
      messages: [
        {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'bad_only', name: '', input: {} },
          ],
        },
      ],
    };

    const result = sanitizeMessages(body);
    expect(result.droppedMessageIndices).toEqual([0]);
    const newBody = result.body as { messages: unknown[] };
    expect(newBody.messages).toHaveLength(0);
  });

  it('handles non-object body gracefully', () => {
    const result = sanitizeMessages(null);
    expect(result.body).toBeNull();
    expect(result.removedToolUseIds).toEqual([]);
  });

  it('preserves unrelated messages', () => {
    const body = {
      messages: [
        { role: 'user', content: 'Hello' },
        {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'bad', name: '', input: {} },
          ],
        },
        { role: 'user', content: 'Next turn' },
      ],
    };

    const result = sanitizeMessages(body);
    const newBody = result.body as { messages: Array<{ role: string }> };
    // Bad message dropped, leaving user messages
    expect(newBody.messages).toHaveLength(2);
    expect(newBody.messages[0].role).toBe('user');
    expect(newBody.messages[1].role).toBe('user');
  });
});
