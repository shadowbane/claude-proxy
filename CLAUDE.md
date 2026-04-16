# Claude-Proxy

Multi-user API proxy for Anthropic-compatible MiMo-v2 endpoint with per-user usage tracking.

## Architecture

- **Server**: TypeScript + Fastify 5 (src/server/)
- **Frontend**: React 19 + React Router 7 + Tailwind CSS 4 (src/web/)
- **Database**: SQLite via better-sqlite3 (WAL mode)
- **Shared types**: src/shared/types.ts
- **Upstream**: `https://token-plan-sgp.xiaomimimo.com/anthropic` (Anthropic-compatible)

Reference project with similar patterns: `/Users/shadowbane/projects/ollama-proxy`

## Commands

```bash
npm run dev           # Start server + web concurrently
npm run dev:server    # Server only (tsx watch)
npm run dev:web       # Vite dev server only
npm run build         # Build web (vite) + server (tsc)
npm start             # Run production build
npm run lint          # ESLint
npm test              # Vitest
```

## Project Structure

```
src/server/           # Fastify backend
  index.ts            # Entry point
  config.ts           # Env var parsing
  db/                 # SQLite connection, schema, repositories
  lib/                # Crypto, usage extraction, request diagnostics
  middleware/         # Admin JWT auth, proxy Bearer auth, rate limit
  routes/             # Route handlers
src/web/              # React SPA
  components/         # UI components
  hooks/              # React hooks for data fetching
  lib/                # API client, utilities
src/shared/           # Shared TypeScript interfaces
docs/                 # Architecture docs and implementation plan
```

## Key Patterns

- **Repository pattern** for all DB access (src/server/db/repositories/)
- **Two auth domains**: JWT cookies for admin `/api/*`, Bearer tokens for proxy `/v1/*`
- **API tokens**: SHA-256 hash for lookup, AES-256-GCM encrypted at rest, bcrypt for passwords
- **Streaming proxy**: Tee response chunks for usage extraction while streaming to client
- **Usage extraction**: Parse Anthropic SSE events (message_start + message_delta) for token counts

## Environment Variables

Required:

- `UPSTREAM_BASE_URL` — MiMo endpoint
- `UPSTREAM_API_KEY` — Shared upstream API key
- `JWT_SECRET` — JWT signing secret
- `TOKEN_ENCRYPTION_KEY` — AES-256-GCM key for token encryption
- `ADMIN_USERNAME` / `ADMIN_PASSWORD` — Initial admin credentials (first startup only)

Optional:

- `PORT` (default: 3000), `HOST` (default: 0.0.0.0)
- `DB_PATH` (default: ./data/proxy.db)
- `TLS_CERT_PATH` / `TLS_KEY_PATH` — Enable HTTPS
- `RATE_LIMIT_MAX` (default: 120), `RATE_LIMIT_WINDOW_MS` (default: 60000)
- `LOG_LEVEL` (default: info), `LOG_DIR` (default: ./data/logs)
- `REQUEST_TIMEOUT_MS` (default: 300000)

## Database

5 tables: `admins`, `users`, `api_tokens`, `request_logs`, `settings`. Schema applied via CREATE IF NOT EXISTS on
startup. See `docs/architecture.md` for full DDL.

## Style

- Follow existing ollama-proxy patterns for consistency
    - Location `/Users/shadowbane/projects/ollama-proxy`
- No unnecessary abstractions — keep it simple
- Prefer editing existing files over creating new ones

<!-- code-review-graph MCP tools -->

## MCP Tools: code-review-graph

**IMPORTANT: This project has a knowledge graph. ALWAYS use the
code-review-graph MCP tools BEFORE using Grep/Glob/Read to explore
the codebase.** The graph is faster, cheaper (fewer tokens), and gives
you structural context (callers, dependents, test coverage) that file
scanning cannot.

### When to use graph tools FIRST

- **Exploring code**: `semantic_search_nodes` or `query_graph` instead of Grep
- **Understanding impact**: `get_impact_radius` instead of manually tracing imports
- **Code review**: `detect_changes` + `get_review_context` instead of reading entire files
- **Finding relationships**: `query_graph` with callers_of/callees_of/imports_of/tests_for
- **Architecture questions**: `get_architecture_overview` + `list_communities`

Fall back to Grep/Glob/Read **only** when the graph doesn't cover what you need.

### Key Tools

| Tool                        | Use when                                               |
|-----------------------------|--------------------------------------------------------|
| `detect_changes`            | Reviewing code changes — gives risk-scored analysis    |
| `get_review_context`        | Need source snippets for review — token-efficient      |
| `get_impact_radius`         | Understanding blast radius of a change                 |
| `get_affected_flows`        | Finding which execution paths are impacted             |
| `query_graph`               | Tracing callers, callees, imports, tests, dependencies |
| `semantic_search_nodes`     | Finding functions/classes by name or keyword           |
| `get_architecture_overview` | Understanding high-level codebase structure            |
| `refactor_tool`             | Planning renames, finding dead code                    |

### Workflow

1. The graph auto-updates on file changes (via hooks).
2. Use `detect_changes` for code review.
3. Use `get_affected_flows` to understand impact.
4. Use `query_graph` pattern="tests_for" to check coverage.
