// Request log repository — CRUD + analytics queries
import type { RequestLog } from '../../../shared/types.js';
import { getDb } from '../connection.js';

// ── Phase 4: Core CRUD ─────────────────────────────

export function create(data: Omit<RequestLog, 'id' | 'created_at'>): RequestLog {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO request_logs (user_id, token_id, model, endpoint, prompt_tokens, completion_tokens,
      cache_creation_input_tokens, cache_read_input_tokens, latency_ms, status, error_message, client_ip)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.user_id,
    data.token_id,
    data.model,
    data.endpoint,
    data.prompt_tokens,
    data.completion_tokens,
    data.cache_creation_input_tokens,
    data.cache_read_input_tokens,
    data.latency_ms,
    data.status,
    data.error_message,
    data.client_ip,
  );

  return {
    id: Number(result.lastInsertRowid),
    ...data,
    created_at: new Date().toISOString(),
  };
}

// ── Phase 5: Analytics queries ──────────────────────

export function getStats(start?: string, end?: string): {
  total: number;
  success: number;
  errors: number;
  avgLatencyMs: number | null;
  promptTokens: number;
  completionTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
} {
  const db = getDb();
  const hasRange = start != null && end != null;
  const where = hasRange
    ? 'WHERE datetime(created_at) >= datetime(?) AND datetime(created_at) < datetime(?)'
    : '';
  const params: string[] = hasRange ? [start, end] : [];

  const row = db.prepare(`
    SELECT
      COUNT(*) as total,
      COALESCE(SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END), 0) as success,
      COALESCE(SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END), 0) as errors,
      AVG(latency_ms) as avgLatencyMs,
      COALESCE(SUM(prompt_tokens), 0) as promptTokens,
      COALESCE(SUM(completion_tokens), 0) as completionTokens,
      COALESCE(SUM(cache_creation_input_tokens), 0) as cacheCreationTokens,
      COALESCE(SUM(cache_read_input_tokens), 0) as cacheReadTokens
    FROM request_logs
    ${where}
  `).get(...params) as {
    total: number;
    success: number;
    errors: number;
    avgLatencyMs: number | null;
    promptTokens: number;
    completionTokens: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
  };

  return {
    ...row,
    totalTokens: (row.promptTokens ?? 0) + (row.completionTokens ?? 0),
  };
}

export function getUsageByUser(start?: string, end?: string): Array<{
  user_id: string;
  user_name: string;
  total_requests: number;
  success: number;
  errors: number;
  prompt_tokens: number;
  completion_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  total_tokens: number;
  last_used_at: string | null;
}> {
  const db = getDb();
  const hasRange = start != null && end != null;
  const rangeClause = hasRange
    ? 'AND datetime(rl.created_at) >= datetime(?) AND datetime(rl.created_at) < datetime(?)'
    : '';
  const params = hasRange ? [start, end] : [];

  const rows = db.prepare(`
    SELECT
      rl.user_id,
      u.name AS user_name,
      COUNT(*) AS total_requests,
      SUM(CASE WHEN rl.status = 'success' THEN 1 ELSE 0 END) AS success,
      SUM(CASE WHEN rl.status = 'error' THEN 1 ELSE 0 END) AS errors,
      COALESCE(SUM(rl.prompt_tokens), 0) AS prompt_tokens,
      COALESCE(SUM(rl.completion_tokens), 0) AS completion_tokens,
      COALESCE(SUM(rl.cache_creation_input_tokens), 0) AS cache_creation_tokens,
      COALESCE(SUM(rl.cache_read_input_tokens), 0) AS cache_read_tokens,
      MAX(rl.created_at) AS last_used_at
    FROM request_logs rl
    LEFT JOIN users u ON u.id = rl.user_id
    WHERE rl.user_id IS NOT NULL
      ${rangeClause}
    GROUP BY rl.user_id, u.name
    ORDER BY (COALESCE(SUM(rl.prompt_tokens), 0) + COALESCE(SUM(rl.completion_tokens), 0)) DESC,
             COUNT(*) DESC
  `).all(...params) as Array<Omit<ReturnType<typeof getUsageByUser>[number], 'total_tokens'>>;

  return rows.map((r) => ({
    ...r,
    total_tokens: (r.prompt_tokens ?? 0) + (r.completion_tokens ?? 0),
  }));
}

export function getTimeSeries(
  startUtc: string,
  endUtc: string,
  tzOffsetMinutes: number,
  bucket: 'hour' | 'day',
  userId?: string,
): Array<{
  bucket: string;
  requests: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}> {
  const db = getDb();
  const fmt = bucket === 'hour' ? '%Y-%m-%d %H:00' : '%Y-%m-%d';
  const shift = `${tzOffsetMinutes} minutes`;
  const userClause = userId ? 'AND user_id = ?' : '';
  const params = userId
    ? [fmt, shift, startUtc, endUtc, userId]
    : [fmt, shift, startUtc, endUtc];

  const rows = db.prepare(`
    SELECT
      strftime(?, datetime(created_at, ?)) AS bucket,
      COUNT(*) AS requests,
      COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
      COALESCE(SUM(completion_tokens), 0) AS completion_tokens
    FROM request_logs
    WHERE datetime(created_at) >= datetime(?)
      AND datetime(created_at) < datetime(?)
      AND status = 'success'
      ${userClause}
    GROUP BY bucket
    ORDER BY bucket ASC
  `).all(...params) as Array<{
    bucket: string;
    requests: number;
    prompt_tokens: number;
    completion_tokens: number;
  }>;

  return rows.map((r) => ({
    ...r,
    total_tokens: (r.prompt_tokens ?? 0) + (r.completion_tokens ?? 0),
  }));
}

export function getPaginated(
  limit = 50,
  offset = 0,
  filters?: { start?: string; end?: string; userId?: string; status?: string },
): { rows: RequestLog[]; total: number } {
  const db = getDb();
  const clauses: string[] = [];
  const params: Array<string | number> = [];

  if (filters?.start && filters?.end) {
    clauses.push('datetime(created_at) >= datetime(?) AND datetime(created_at) < datetime(?)');
    params.push(filters.start, filters.end);
  }
  if (filters?.userId) {
    clauses.push('user_id = ?');
    params.push(filters.userId);
  }
  if (filters?.status) {
    clauses.push('status = ?');
    params.push(filters.status);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

  const countRow = db.prepare(`SELECT COUNT(*) as c FROM request_logs ${where}`)
    .get(...params) as { c: number };

  const rows = db.prepare(
    `SELECT * FROM request_logs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
  ).all(...params, limit, offset) as RequestLog[];

  return { rows, total: countRow.c };
}
