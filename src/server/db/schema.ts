// Database schema — all CREATE statements
export const SCHEMA_SQL = `
-- Admins (dashboard login)
CREATE TABLE IF NOT EXISTS admins (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Users (API consumers)
CREATE TABLE IF NOT EXISTS users (
  id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  name       TEXT    NOT NULL,
  email      TEXT,
  enabled    INTEGER NOT NULL DEFAULT 1,
  created_by TEXT    REFERENCES admins(id) ON DELETE SET NULL,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- API Tokens (one user can have many tokens)
CREATE TABLE IF NOT EXISTS api_tokens (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  user_id         TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            TEXT    NOT NULL DEFAULT 'default',
  token_hash      TEXT    NOT NULL UNIQUE,
  token_encrypted TEXT    NOT NULL,
  token_iv        TEXT    NOT NULL,
  token_auth_tag  TEXT    NOT NULL,
  token_prefix    TEXT    NOT NULL,
  enabled         INTEGER NOT NULL DEFAULT 1,
  last_used_at    TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Request Logs (usage tracking)
CREATE TABLE IF NOT EXISTS request_logs (
  id                          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id                     TEXT REFERENCES users(id) ON DELETE SET NULL,
  token_id                    TEXT REFERENCES api_tokens(id) ON DELETE SET NULL,
  model                       TEXT NOT NULL DEFAULT '',
  endpoint                    TEXT NOT NULL DEFAULT '',
  prompt_tokens               INTEGER DEFAULT 0,
  completion_tokens           INTEGER DEFAULT 0,
  cache_creation_input_tokens INTEGER DEFAULT 0,
  cache_read_input_tokens     INTEGER DEFAULT 0,
  latency_ms                  INTEGER DEFAULT 0,
  status                      TEXT NOT NULL DEFAULT 'success',
  error_message               TEXT,
  client_ip                   TEXT,
  created_at                  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Settings (key-value)
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_users_enabled ON users(enabled);
CREATE INDEX IF NOT EXISTS idx_api_tokens_hash ON api_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_api_tokens_user_id ON api_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_request_logs_created ON request_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_request_logs_user_id ON request_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_request_logs_user_created ON request_logs(user_id, created_at);
`;
