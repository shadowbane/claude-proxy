// Best-effort extractor for Anthropic-compatible usage/token-count metadata
// from upstream responses. Handles both JSON and SSE stream formats.

type UsageRecord = Record<string, unknown>;

function mergeUsage(target: UsageRecord, src: UsageRecord): void {
  for (const [k, v] of Object.entries(src)) {
    if (v !== undefined && v !== null) target[k] = v;
  }
}

function fromJsonObject(obj: unknown): UsageRecord | null {
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  if (o.usage && typeof o.usage === 'object') {
    return o.usage as UsageRecord;
  }
  return null;
}

function fromSse(body: string): UsageRecord | null {
  const merged: UsageRecord = {};
  for (const rawLine of body.split('\n')) {
    const line = rawLine.trim();
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') continue;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(data) as Record<string, unknown>;
    } catch {
      continue;
    }

    // Anthropic streaming: usage on message_start.message and message_delta
    if (obj.type === 'message_start' && obj.message && typeof obj.message === 'object') {
      const m = obj.message as Record<string, unknown>;
      if (m.usage && typeof m.usage === 'object') {
        mergeUsage(merged, m.usage as UsageRecord);
      }
    }
    if (obj.type === 'message_delta' && obj.usage && typeof obj.usage === 'object') {
      mergeUsage(merged, obj.usage as UsageRecord);
    }

    // Fallback: top-level usage field
    if (obj.usage && typeof obj.usage === 'object' && obj.type !== 'message_start' && obj.type !== 'message_delta') {
      mergeUsage(merged, obj.usage as UsageRecord);
    }
  }
  return Object.keys(merged).length > 0 ? merged : null;
}

export function extractUsage(body: string, contentType: string): UsageRecord | null {
  if (!body) return null;

  const ct = contentType.toLowerCase();
  const looksLikeSse =
    ct.includes('text/event-stream') || body.startsWith('data:') || body.includes('\ndata:');

  if (looksLikeSse) {
    return fromSse(body);
  }

  try {
    return fromJsonObject(JSON.parse(body));
  } catch {
    // Last resort: maybe SSE without the right content-type
    return fromSse(body);
  }
}

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function normalizeTokens(usage: UsageRecord | null): {
  prompt: number | null;
  completion: number | null;
  cacheCreation: number | null;
  cacheRead: number | null;
} {
  if (!usage) return { prompt: null, completion: null, cacheCreation: null, cacheRead: null };
  const prompt = numOrNull(usage.input_tokens);
  const completion = numOrNull(usage.output_tokens);
  const cacheCreation = numOrNull(usage.cache_creation_input_tokens);
  const cacheRead = numOrNull(usage.cache_read_input_tokens);
  return { prompt, completion, cacheCreation, cacheRead };
}
