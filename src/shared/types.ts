// ── Admin ─────────────────────────────────────────
export interface Admin {
  id: string;
  username: string;
  password_hash: string;
  created_at: string;
  updated_at: string;
}

// ── User (API consumer) ──────────────────────────
export interface User {
  id: string;
  name: string;
  email: string | null;
  enabled: number; // SQLite boolean: 0 | 1
  daily_token_quota: number | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserCreate {
  name: string;
  email?: string;
  enabled?: boolean;
  daily_token_quota?: number | null;
}

export interface UserUpdate {
  name?: string;
  email?: string;
  enabled?: boolean;
  daily_token_quota?: number | null;
}

// ── API Token ────────────────────────────────────
export interface ApiToken {
  id: string;
  user_id: string;
  name: string;
  token_hash: string;
  token_encrypted: string;
  token_iv: string;
  token_auth_tag: string;
  token_prefix: string;
  enabled: number;
  last_used_at: string | null;
  created_at: string;
}

export interface ApiTokenMasked {
  id: string;
  user_id: string;
  name: string;
  token_prefix: string;
  enabled: number;
  last_used_at: string | null;
  created_at: string;
}

// ── Request Log ──────────────────────────────────
export interface RequestLog {
  id: number;
  user_id: string | null;
  token_id: string | null;
  model: string;
  endpoint: string;
  prompt_tokens: number;
  completion_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  estimated_credits: number | null;
  latency_ms: number;
  status: string;
  error_message: string | null;
  client_ip: string | null;
  created_at: string;
}

// ── Settings ─────────────────────────────────────
export interface Setting {
  key: string;
  value: string;
  updated_at: string;
}

// ── Usage Stats ──────────────────────────────────
export interface UsageStats {
  total_requests: number;
  success_count: number;
  error_count: number;
  total_prompt_tokens: number;
  total_completion_tokens: number;
  total_cache_creation_tokens: number;
  total_cache_read_tokens: number;
  avg_latency_ms: number;
}

export interface UserUsageSummary {
  user_id: string;
  user_name: string;
  total_requests: number;
  total_prompt_tokens: number;
  total_completion_tokens: number;
  last_used_at: string | null;
}

export interface TimeSeriesBucket {
  bucket: string;
  requests: number;
  prompt_tokens: number;
  completion_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  estimated_credits: number;
}

// ── Quota Override ──────────────────────────────────
export interface QuotaOverride {
  id: string;
  user_id: string;
  start_date: string;   // YYYY-MM-DD
  end_date: string;     // YYYY-MM-DD, inclusive
  max_tokens: number;
  note: string | null;
  created_at: string;
}

export interface QuotaOverrideCreate {
  start_date: string;
  end_date: string;
  max_tokens: number;
  note?: string;
}

export interface QuotaStatus {
  quota_limit: number | null;       // effective limit, null = unlimited
  quota_source: 'override' | 'user' | 'default' | 'none';
  tokens_used: number;
  tokens_remaining: number | null;  // null = unlimited
  window_start: string;
  window_end: string;
  override_id?: string;
}
