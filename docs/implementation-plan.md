# Claude-Proxy: Implementation Plan

Phased implementation plan. Each phase builds on the previous and produces a testable deliverable.

---

## Phase 1: Project Scaffolding & Database

**Goal:** Working project skeleton with database and build pipeline.

**Tasks:**

1. `npm init`, install dependencies:
    - Server: `fastify`, `better-sqlite3`, `bcryptjs`, `@fastify/jwt`, `@fastify/cookie`, `@fastify/cors`,
      `@fastify/rate-limit`, `@fastify/static`, `pino`, `pino-pretty`
    - Web: `react`, `react-dom`, `react-router`, `recharts`, `tailwindcss`
    - Dev: `typescript`, `tsx`, `vite`, `@types/*`, `eslint`, `prettier`
2. Create config files: `tsconfig.json`, `tsconfig.server.json`, `tsconfig.web.json`, `vite.config.ts`,
   `tailwind.config.ts`, `postcss.config.js`, `.gitignore`, `.env.example`
3. Create `src/server/config.ts` — parse all env vars with defaults
4. Create `src/server/db/schema.ts` — full DDL (admins, users, api_tokens, request_logs, settings)
5. Create `src/server/db/connection.ts` — SQLite singleton, apply schema on init
6. Create `src/shared/types.ts` — shared interfaces
7. Create `src/server/index.ts` — minimal Fastify boot that initializes DB and listens

**Verify:** `npm run dev:server` starts, creates `data/proxy.db` with all tables.

---

## Phase 2: Crypto Layer & Admin Auth

**Goal:** Working admin login with JWT.

**Tasks:**

1. Create `src/server/lib/crypto.ts`:
    - `hashPassword(plain)` / `verifyPassword(plain, hash)` — bcryptjs, 12 rounds
    - `encryptToken(plain)` / `decryptToken(encrypted, iv, authTag)` — AES-256-GCM
    - `hashToken(plain)` — SHA-256 hex
    - `generateApiToken()` — `cp_live_` + 48 random hex chars
2. Create `src/server/db/repositories/admin.ts` — create, getByUsername, getById
3. Add admin seeding to `connection.ts` — if no admins exist, create from `ADMIN_USERNAME`/`ADMIN_PASSWORD` env vars
4. Register `@fastify/jwt` and `@fastify/cookie` in `index.ts`
5. Create `src/server/routes/auth.ts`:
    - `POST /api/auth/login` — validate credentials, issue JWT + httpOnly cookie
    - `POST /api/auth/logout` — clear cookie
    - `GET /api/auth/me` — return current admin
    - `POST /api/auth/change-password` — update password
6. Create `src/server/middleware/admin-auth.ts` — JWT preHandler for `/api/*` routes
7. Create `src/server/middleware/error-handler.ts`
8. Create `src/server/middleware/rate-limit.ts`

**Verify:** `curl -X POST localhost:3000/api/auth/login -d '{"username":"admin","password":"..."}' ` returns JWT.
`GET /api/auth/me` with cookie works.

---

## Phase 3: User & Token Management

**Goal:** Full CRUD for users and API tokens.

**Tasks:**

1. Create `src/server/db/repositories/user.ts` — list, getById, create, update, delete
2. Create `src/server/db/repositories/api-token.ts`:
    - `create(userId, name)` — generates token, stores hash + encrypted + prefix
    - `findByHash(hash)` — O(1) lookup with JOIN to users for enabled check
    - `listByUser(userId)` — masked list
    - `revoke(tokenId)` — delete
    - `update(tokenId, fields)` — name, enabled
    - `reveal(tokenId)` — decrypt and return
    - `touchLastUsed(tokenId)` — update timestamp
3. Create `src/server/routes/users.ts`:
    - `GET /api/users` — list all
    - `POST /api/users` — create
    - `GET /api/users/:id` — detail
    - `PUT /api/users/:id` — update
    - `DELETE /api/users/:id` — delete (cascades tokens)
4. Create `src/server/routes/tokens.ts`:
    - `GET /api/users/:id/tokens` — list tokens
    - `POST /api/users/:id/tokens` — create (returns raw token once)
    - `DELETE /api/tokens/:tokenId` — revoke
    - `PUT /api/tokens/:tokenId` — update
    - `POST /api/tokens/:tokenId/reveal` — decrypt and show

**Verify:** Create user via curl, generate token, list tokens (masked), reveal token.

---

## Phase 4: Proxy Route

**Goal:** Working proxy that forwards Anthropic-compatible requests to MiMo.

**Tasks:**

1. Create `src/server/middleware/proxy-auth.ts`:
    - Extract Bearer token from Authorization header
    - SHA-256 hash it, look up in `api_tokens`
    - Validate token and user are enabled
    - Attach `user_id` and `token_id` to request
2. Create `src/server/lib/usage-extractor.ts` (adapted from reference):
    - Parse Anthropic SSE: `message_start.message.usage` + `message_delta.usage`
    - Parse Anthropic JSON: `usage.input_tokens`, `usage.output_tokens`
    - Include `cache_creation_input_tokens`, `cache_read_input_tokens`
3. Create `src/server/lib/request-diagnostics.ts` (from reference):
    - `findMalformedToolUse(body)` — diagnose broken tool_use blocks
    - `sanitizeMessages(body)` — strip malformed blocks + orphaned tool_results
    - This is a defensive measure; may not be needed for MiMo but costs nothing
4. Create `src/server/db/repositories/request-log.ts`:
    - `create(fields)` — insert log entry
    - `updateTokens(logId, prompt, completion, cacheCreate, cacheRead)` — update after extraction
5. Create `src/server/routes/proxy.ts`:
    - `POST /v1/messages` — full proxy with streaming tee + usage extraction
    - `HEAD /v1/messages` — liveness probe
    - Forward `anthropic-version`, `anthropic-beta` headers
    - Preserve query string (e.g., `?beta=true`)
    - Replace `Authorization` with upstream key

**Verify:** Create user + token, then:

```bash
curl -X POST http://localhost:3000/v1/messages \
  -H "Authorization: Bearer cp_live_..." \
  -H "Content-Type: application/json" \
  -H "anthropic-version: 2023-06-01" \
  -d '{"model":"...","messages":[{"role":"user","content":"Hello"}],"max_tokens":100}'
```

---

## Phase 5: Analytics Backend

**Goal:** Full analytics query layer for usage tracking.

**Tasks:**

1. Expand `src/server/db/repositories/request-log.ts`:
    - `getStats(start, end)` — total requests, success/error, avg latency, total tokens
    - `getUsageByUser(start, end)` — per-user summary (tokens, requests, last_used)
    - `getTimeSeries(userId?, start, end, bucket, tzOffset)` — bucketed time-series
    - `getPaginated(limit, offset, filters)` — paginated request logs
2. Create `src/server/db/repositories/settings.ts` — get/upsert key-value pairs
3. Create `src/server/routes/usage.ts`:
    - `GET /api/usage/stats?start=&end=`
    - `GET /api/usage/by-user?start=&end=`
    - `GET /api/usage/by-user/:id/timeseries?start=&end=&bucket=`
    - `GET /api/usage/timeseries?start=&end=&bucket=`
4. Create `src/server/routes/request-logs.ts`:
    - `GET /api/logs?limit=&offset=&start=&end=`
5. Create `src/server/routes/settings.ts`:
    - `GET /api/settings`
    - `PUT /api/settings`

**Verify:** Make several proxy requests, then query analytics endpoints to see per-user breakdowns.

---

## Phase 6: Frontend - Auth & Layout

**Goal:** Working admin login and app shell.

**Tasks:**

1. Create `src/web/index.html`, `src/web/main.tsx`, `src/web/styles/globals.css`
2. Create `src/web/lib/api.ts` — fetch wrapper with cookie auth, error handling
3. Create `src/web/hooks/useAuth.ts` — login/logout/session state
4. Create `src/web/components/auth/LoginPage.tsx`
5. Create `src/web/components/layout/AuthGuard.tsx` — redirect if not authenticated
6. Create `src/web/components/layout/Sidebar.tsx`
7. Create `src/web/components/layout/Header.tsx`
8. Create `src/web/App.tsx` — router with AuthGuard wrapping all routes

**Verify:** Open browser, see login page, log in, see dashboard shell with sidebar.

---

## Phase 7: Frontend - User & Token Management

**Goal:** Full user and token management UI.

**Tasks:**

1. Create hooks: `useUsers.ts`, `useUserTokens.ts`
2. Create `UsersPage.tsx` — table with name, email, enabled toggle, actions
3. Create `AddUserModal.tsx`, `EditUserModal.tsx`
4. Create `UserDetailPage.tsx` — user info card + token section + usage section
5. Create `TokenList.tsx` — token table with prefix, enabled, last used, revoke
6. Create `CreateTokenModal.tsx` — shows raw token ONCE with copy-to-clipboard
7. Create shared: `ConfirmDialog.tsx`, `StatusBadge.tsx`

**Verify:** Create user, generate token, copy token, toggle enabled, revoke token — all from the UI.

---

## Phase 8: Frontend - Analytics Dashboard

**Goal:** Usage visualization with charts.

**Tasks:**

1. Create hooks: `useUsage.ts`, `useUserUsage.ts`
2. Create `UsageDashboard.tsx` — stat cards + per-user table + global chart
3. Create `UsageChart.tsx` — reusable Recharts time-series component
4. Create `DateRangeBar.tsx` — today / 7d / 30d / custom range picker
5. Create `StatCard.tsx` — reusable stat display card
6. Add usage charts to `UserDetailPage.tsx`
7. Create `src/web/lib/date-range.ts` — date utilities

**Verify:** Make proxy requests, see usage appear in dashboard charts with correct per-user attribution.

---

## Phase 9: Frontend - Logs & Settings

**Goal:** Complete remaining dashboard pages.

**Tasks:**

1. Create hooks: `useRequestLogs.ts`, `useSettings.ts`
2. Create `LogsPage.tsx` — request log table with user, model, tokens, status, latency
3. Create `Pagination.tsx`
4. Create `SettingsPage.tsx` — server info, change password form

**Verify:** Full admin dashboard functional end-to-end.

---

## Phase 10: Docker, TLS & Production

**Goal:** Production-ready deployment.

**Tasks:**

1. Create `docker/Dockerfile` — multi-stage build (build + runtime)
2. Create `docker/docker-compose.yml`
3. Add TLS support to `src/server/index.ts` (conditional on env vars)
4. Add `@fastify/helmet` for security headers
5. Configure CORS for production (restrict origins)
6. Add request body size limits
7. Create `.env.example` with documentation
8. Initialize git, create `.gitignore`

**Verify:** `docker compose up` runs the full app. TLS works with provided certs.
