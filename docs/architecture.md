# Claude-Proxy: Architecture & System Design

## Problem Statement

Our workplace has a single shared MiMo-v2 API key with a 1.6B token/month budget shared across several users. There's no
visibility into:

- **Who** is consuming tokens
- **How many** tokens each person uses
- **When** they're being used (e.g., outside work hours)

Claude-proxy sits between users and the upstream API to authenticate, proxy, and track per-user usage.

## High-Level Architecture

```
                                 +-------------------+
  Claude Code / curl             |   claude-proxy    |
  (User with Bearer token)  ---->|                   |----> MiMo-v2 Upstream
                                 |  Fastify + SQLite |      https://token-plan-sgp.
                                 |                   |      xiaomimimo.com/anthropic
  Admin Browser             ---->|  React SPA        |
  (JWT session)                  +-------------------+
```

### Two Authentication Domains

| Domain              | Who              | How                               | Protects        |
|---------------------|------------------|-----------------------------------|-----------------|
| **Admin auth**      | Dashboard admins | Username/password -> JWT cookie   | `/api/*` routes |
| **User proxy auth** | API consumers    | Bearer token (generated per-user) | `/v1/messages`  |

### Data Flow (Proxy Request)

1. Client sends `POST /v1/messages` with `Authorization: Bearer cp_live_...`
2. Proxy middleware: SHA-256 hashes the token, looks up `api_tokens` table
3. Validates token is enabled, parent user is enabled
4. Forwards request to upstream with the shared `UPSTREAM_API_KEY`
5. Streams response back to client while tee'ing into a buffer
6. Extracts token usage from Anthropic SSE events
7. Logs usage to `request_logs` with user attribution

## Tech Stack

| Layer            | Library                              | Rationale                                  |
|------------------|--------------------------------------|--------------------------------------------|
| Runtime          | Node.js 20+                          | Same as reference ollama-proxy             |
| Server           | Fastify 5                            | Fast, plugin-based, TypeScript-native      |
| Database         | SQLite (better-sqlite3)              | Zero-dependency, sufficient for this scale |
| Web Framework    | React 19 + React Router 7            | Same as reference                          |
| Build            | Vite 6 + tsc                         | Same as reference                          |
| Styling          | Tailwind CSS 4                       | Same as reference                          |
| Charts           | Recharts 3                           | Same as reference                          |
| Password hashing | bcryptjs                             | Pure JS bcrypt (no native deps)            |
| Encryption       | Node `crypto` (built-in)             | AES-256-GCM for token encryption           |
| JWT              | @fastify/jwt                         | Admin session tokens                       |
| Cookies          | @fastify/cookie                      | httpOnly JWT cookie                        |
| TLS              | Fastify native https / reverse proxy | Encrypted proxy                            |

## Database Schema

```sql
-- Admins (dashboard login)
CREATE TABLE IF NOT EXISTS admins
(
    id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL, -- bcrypt
    created_at    TEXT NOT NULL    DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL    DEFAULT (datetime('now'))
);

-- Users (API consumers)
CREATE TABLE IF NOT EXISTS users
(
    id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    name       TEXT    NOT NULL,
    email      TEXT,
    enabled    INTEGER NOT NULL DEFAULT 1,
    created_by TEXT    REFERENCES admins (id) ON DELETE SET NULL,
    created_at TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- API Tokens (one user can have many tokens)
-- token_hash:      SHA-256 of raw token (for O(1) lookup on every request)
-- token_encrypted: AES-256-GCM encrypted raw token (for admin reveal)
-- token_prefix:    first 8 chars for display (e.g., "cp_live_")
CREATE TABLE IF NOT EXISTS api_tokens
(
    id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    user_id         TEXT    NOT NULL REFERENCES users (id) ON DELETE CASCADE,
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
CREATE TABLE IF NOT EXISTS request_logs
(
    id                          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id                     TEXT REFERENCES users (id) ON DELETE SET NULL,
    token_id                    TEXT REFERENCES api_tokens (id) ON DELETE SET NULL,
    model                       TEXT NOT NULL DEFAULT '',
    endpoint                    TEXT NOT NULL DEFAULT '',
    prompt_tokens               INTEGER       DEFAULT 0,
    completion_tokens           INTEGER       DEFAULT 0,
    cache_creation_input_tokens INTEGER       DEFAULT 0,
    cache_read_input_tokens     INTEGER       DEFAULT 0,
    latency_ms                  INTEGER       DEFAULT 0,
    status                      TEXT NOT NULL DEFAULT 'success',
    error_message               TEXT,
    client_ip                   TEXT,
    created_at                  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Settings (key-value)
CREATE TABLE IF NOT EXISTS settings
(
    key TEXT PRIMARY KEY,
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
```

## Encryption Strategy

### Passwords (bcrypt)

- Admin passwords hashed with bcryptjs (12 salt rounds)
- Only used during admin login (infrequent)

### API Tokens (SHA-256 + AES-256-GCM)

- **Lookup**: SHA-256 hash stored for O(1) indexed lookup on every proxy request. High-entropy tokens (48 random hex
  chars) make brute-forcing infeasible.
- **Encrypted storage**: AES-256-GCM encrypted form stored so admins can reveal/re-share tokens. Encryption key from
  `TOKEN_ENCRYPTION_KEY` env var.
- **Display**: First 8 chars (`token_prefix`) stored in plaintext for list display.
- **On creation**: Raw token returned ONCE in the response.

### TLS

- Fastify native TLS support via `TLS_CERT_PATH` and `TLS_KEY_PATH` env vars
- Alternative: run behind nginx/Caddy reverse proxy for TLS termination

## API Endpoints

### Auth

| Method | Path                        | Auth | Description           |
|--------|-----------------------------|------|-----------------------|
| POST   | `/api/auth/login`           | None | Login, returns JWT    |
| POST   | `/api/auth/logout`          | JWT  | Clears session cookie |
| GET    | `/api/auth/me`              | JWT  | Current admin info    |
| POST   | `/api/auth/change-password` | JWT  | Change password       |

### User Management

| Method | Path             | Auth | Description                   |
|--------|------------------|------|-------------------------------|
| GET    | `/api/users`     | JWT  | List users                    |
| POST   | `/api/users`     | JWT  | Create user                   |
| GET    | `/api/users/:id` | JWT  | Get user                      |
| PUT    | `/api/users/:id` | JWT  | Update user                   |
| DELETE | `/api/users/:id` | JWT  | Delete user (cascades tokens) |

### Token Management

| Method | Path                          | Auth | Description                     |
|--------|-------------------------------|------|---------------------------------|
| GET    | `/api/users/:id/tokens`       | JWT  | List user's tokens (masked)     |
| POST   | `/api/users/:id/tokens`       | JWT  | Create token (returns raw once) |
| DELETE | `/api/tokens/:tokenId`        | JWT  | Revoke token                    |
| PUT    | `/api/tokens/:tokenId`        | JWT  | Update token (name, enabled)    |
| POST   | `/api/tokens/:tokenId/reveal` | JWT  | Decrypt and return full token   |

### Usage Analytics

| Method | Path                                | Auth | Description            |
|--------|-------------------------------------|------|------------------------|
| GET    | `/api/usage/stats`                  | JWT  | Aggregate stats        |
| GET    | `/api/usage/by-user`                | JWT  | Per-user usage summary |
| GET    | `/api/usage/by-user/:id/timeseries` | JWT  | User time-series       |
| GET    | `/api/usage/timeseries`             | JWT  | Global time-series     |

All analytics endpoints accept: `start`, `end` (ISO dates), `bucket` (hour/day/week/month).

### Proxy

| Method | Path           | Auth         | Description         |
|--------|----------------|--------------|---------------------|
| POST   | `/v1/messages` | Bearer Token | Forward to upstream |
| HEAD   | `/v1/messages` | None         | Liveness probe      |
| GET    | `/api/health`  | None         | Health check        |

### Settings & Logs

| Method | Path            | Auth | Description            |
|--------|-----------------|------|------------------------|
| GET    | `/api/settings` | JWT  | Get settings           |
| PUT    | `/api/settings` | JWT  | Update settings        |
| GET    | `/api/logs`     | JWT  | Paginated request logs |

## Frontend Pages

1. **Login** - Username/password form
2. **Dashboard** (`/`) - Global usage overview, per-user breakdown table, time-series chart
3. **Users** (`/users`) - User list with create/edit/delete
4. **User Detail** (`/users/:id`) - User info, token management, usage charts
5. **Logs** (`/logs`) - Paginated request log viewer
6. **Settings** (`/settings`) - Server info, password change

## Environment Configuration

```bash
PORT=3000
HOST=0.0.0.0
NODE_ENV=development
DB_PATH=./data/proxy.db
UPSTREAM_BASE_URL=https://token-plan-sgp.xiaomimimo.com/anthropic
UPSTREAM_API_KEY=sk-your-shared-upstream-key
JWT_SECRET=change-me-to-a-random-string
TOKEN_ENCRYPTION_KEY=change-me-to-another-random-string
ADMIN_USERNAME=admin
ADMIN_PASSWORD=change-me
# TLS_CERT_PATH=/path/to/cert.pem
# TLS_KEY_PATH=/path/to/key.pem
RATE_LIMIT_MAX=120
RATE_LIMIT_WINDOW_MS=60000
LOG_LEVEL=info
LOG_DIR=./data/logs
REQUEST_TIMEOUT_MS=300000
```
