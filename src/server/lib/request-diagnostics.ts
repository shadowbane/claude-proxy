// Walk an Anthropic-style /v1/messages body and surface any tool_use blocks
// that violate the schema (missing name, missing id, or empty input). The
// proxy uses this to attach a diagnosis to upstream 400s so the client bug
// is visible without needing to log the entire conversation.

export interface ToolUseProblem {
  messageIndex: number;
  role: string;
  blockIndex: number;
  problem: string;
  block: Record<string, unknown>;
}

interface MessagesBody {
  messages?: Array<{ role?: string; content?: unknown }>;
}

export function findMalformedToolUse(body: unknown): ToolUseProblem[] {
  const out: ToolUseProblem[] = [];
  if (!body || typeof body !== 'object') return out;

  const messages = (body as MessagesBody).messages;
  if (!Array.isArray(messages)) return out;

  messages.forEach((msg, mi) => {
    if (!msg || typeof msg !== 'object') return;
    const content = msg.content;
    if (!Array.isArray(content)) return;

    content.forEach((block, bi) => {
      if (!block || typeof block !== 'object') return;
      const b = block as Record<string, unknown>;
      if (b.type !== 'tool_use') return;

      const problems: string[] = [];
      const name = b.name;
      if (typeof name !== 'string' || name.length === 0) {
        problems.push("missing 'name'");
      }
      if (typeof b.id !== 'string' || (b.id as string).length === 0) {
        problems.push("missing 'id'");
      }
      if (b.input === undefined || b.input === null) {
        problems.push("missing 'input'");
      }

      if (problems.length > 0) {
        out.push({
          messageIndex: mi,
          role: typeof msg.role === 'string' ? msg.role : '?',
          blockIndex: bi,
          problem: problems.join(', '),
          block: b,
        });
      }
    });
  });

  return out;
}

export interface SanitizeResult {
  body: unknown;
  removedToolUseIds: string[];
  removedToolResultIds: string[];
  droppedMessageIndices: number[];
}

// Strip malformed tool_use blocks (missing name) from an Anthropic /v1/messages
// body, plus any tool_result blocks that reference the dropped ids. If an
// assistant message becomes empty after stripping, drop the message entirely.
// Returns a new body — does not mutate the input.
export function sanitizeMessages(body: unknown): SanitizeResult {
  const result: SanitizeResult = {
    body,
    removedToolUseIds: [],
    removedToolResultIds: [],
    droppedMessageIndices: [],
  };

  if (!body || typeof body !== 'object') return result;
  const messages = (body as MessagesBody).messages;
  if (!Array.isArray(messages)) return result;

  // First pass: find ids of malformed tool_use blocks.
  const badIds = new Set<string>();
  for (const msg of messages) {
    if (!msg || typeof msg !== 'object' || !Array.isArray(msg.content)) continue;
    for (const block of msg.content as Array<Record<string, unknown>>) {
      if (block?.type !== 'tool_use') continue;
      const name = block.name;
      if (typeof name !== 'string' || name.length === 0) {
        const id = typeof block.id === 'string' ? block.id : '';
        if (id) badIds.add(id);
      }
    }
  }

  if (badIds.size === 0) return result;

  // Second pass: rebuild messages with offending blocks (and matching
  // tool_results) stripped.
  const newMessages: Array<Record<string, unknown>> = [];
  messages.forEach((msg, mi) => {
    if (!msg || typeof msg !== 'object') {
      newMessages.push(msg as unknown as Record<string, unknown>);
      return;
    }
    if (!Array.isArray(msg.content)) {
      newMessages.push({ ...(msg as Record<string, unknown>) });
      return;
    }

    const newContent: Array<Record<string, unknown>> = [];
    for (const block of msg.content as Array<Record<string, unknown>>) {
      if (!block || typeof block !== 'object') {
        newContent.push(block);
        continue;
      }
      if (block.type === 'tool_use') {
        const name = block.name;
        if (typeof name !== 'string' || name.length === 0) {
          const id = typeof block.id === 'string' ? block.id : '';
          result.removedToolUseIds.push(id);
          continue;
        }
      }
      if (block.type === 'tool_result') {
        const refId = typeof block.tool_use_id === 'string' ? block.tool_use_id : '';
        if (refId && badIds.has(refId)) {
          result.removedToolResultIds.push(refId);
          continue;
        }
      }
      newContent.push(block);
    }

    if (newContent.length === 0) {
      result.droppedMessageIndices.push(mi);
      return;
    }
    newMessages.push({ ...(msg as Record<string, unknown>), content: newContent });
  });

  result.body = { ...(body as Record<string, unknown>), messages: newMessages };
  return result;
}
