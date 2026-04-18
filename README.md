# Claude Proxy

Multi-user API proxy for Anthropic-compatible endpoints with per-user usage tracking, an admin dashboard, and streaming
support.

Built with TypeScript, Fastify 5, React 19, and SQLite.

## Features

- **Anthropic-compatible proxy** — drop-in `/v1/messages` endpoint; works with Claude Code, SDKs, and any
  Anthropic-compatible client
- **Multi-user management** — create users, issue per-user API tokens, enable/disable access
- **Usage tracking** — automatic token counting (prompt, completion, cache creation, cache read) extracted from
  streaming SSE responses
- **Admin dashboard** — web UI with usage charts, request logs, user management, and settings
- **Streaming-first** — tees upstream response chunks to clients in real time while extracting usage in the background
- **Security** — API tokens are SHA-256 hashed for lookup and AES-256-GCM encrypted at rest; admin passwords are
  bcrypt-hashed; JWT cookie auth for the dashboard
- **Daily token quotas** — global default limit + per-user overrides, configurable reset time, date-range overrides, and
  automatic proxy enforcement (429 when exceeded)
- **Monthly MiMo credit limits** — per-request `estimated_credits` computed using the MiMo Token Plan multipliers
  (`mimo-v2-pro` = 2×, `mimo-v2-omni` = 1×, `mimo-v2-tts` = 0×) including cache reads, with a global default,
  per-user limit, and date-ranged credit overrides. Enforced before each request (429 when exceeded) and surfaced in
  the dashboard. See [`docs/credit-limit.md`](docs/credit-limit.md).
- **Rate limiting** — configurable per-IP rate limits
- **Reverse-proxy aware** — opt-in `TRUST_PROXY` resolves the real client IP behind nginx/caddy/traefik;
  `TRUST_CLOUDFLARE` auto-fetches and refreshes Cloudflare's published CIDRs every 7 days
- **TLS support** — optional HTTPS via cert/key paths
- **Request diagnostics** — automatically detects and sanitizes malformed `tool_use` blocks before forwarding
- **Streaming log tooling** — `app.log`/`error.log` cleanup and viewer process line-by-line, bounded memory regardless
  of file size; client IP is attached to error/warn entries and surfaced in the dashboard

## Requirements

- **Node.js** >= 22
- **npm** >= 10

## Quick Start

### 1. Clone and install

```bash
git clone <repo-url> claude-proxy
cd claude-proxy
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and set the required values:

```dotenv
# Your upstream Anthropic-compatible API key
UPSTREAM_API_KEY=sk-your-upstream-key

# A random secret for signing JWT tokens (admin dashboard auth)
JWT_SECRET=generate-a-random-string-here

# A random secret for encrypting API tokens at rest (AES-256-GCM)
TOKEN_ENCRYPTION_KEY=generate-another-random-string-here

# Admin credentials — used to seed the first admin account on initial startup
ADMIN_USERNAME=admin
ADMIN_PASSWORD=choose-a-strong-password
```

You can generate random secrets with:

```bash
openssl rand -hex 32
```

### 3. Start development server

```bash
npm run dev
```

This starts both the Fastify backend (with hot reload) and the Vite dev server concurrently. The dashboard will be
available at `http://localhost:5173` (Vite proxy) and the API at `http://localhost:3000`.

### 4. Log in

Open the dashboard and log in with the `ADMIN_USERNAME` / `ADMIN_PASSWORD` you configured. From there you can:

1. **Create users** — give each API consumer their own identity
2. **Generate API tokens** — each user can have multiple tokens
3. **Monitor usage** — view per-user token consumption and request logs

### 5. Use the proxy

Point any Anthropic-compatible client at your proxy:

```bash
# Example with curl
curl http://localhost:3000/v1/messages \
  -H "Authorization: Bearer sk-your-user-token" \
  -H "Content-Type: application/json" \
  -H "anthropic-version: 2023-06-01" \
  -d '{
    "model": "mimo-v2-pro",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

```bash
# Example with Claude Code
ANTHROPIC_BASE_URL=http://localhost:3000 \
ANTHROPIC_API_KEY=sk-your-user-token \
claude
```

## Production Deployment

### Build and run directly

```bash
npm run build
npm start
```

This compiles the TypeScript server and bundles the React frontend. In production mode, Fastify serves the SPA as static
files with an SPA fallback.

### Docker

```bash
# Build and run with Docker Compose
docker compose up -d
```

Or build the image directly:

```bash
docker build -t claude-proxy .
docker run -d \
  --name claude-proxy \
  -p 3000:3000 \
  -v claude-proxy-data:/app/data \
  --env-file .env \
  -e NODE_ENV=production \
  -e DB_PATH=/app/data/proxy.db \
  -e LOG_DIR=/app/data/logs \
  claude-proxy
```

The Docker image uses a multi-stage build (Node 22 Alpine) and stores the SQLite database and logs in `/app/data` —
mount a volume there for persistence.

### Behind a reverse proxy

When the proxy sits behind nginx, caddy, traefik, or similar, set `TRUST_PROXY` so `request.ip` (used for rate-limit
keying and request-log auditing) reflects the real client instead of the upstream proxy. Pick the value that matches
your topology:

- **Behind an internal proxy that already validates Cloudflare upstream** (the common Traefik → nginx → Node setup):
  `TRUST_PROXY=loopback,uniquelocal`. This trusts loopback and RFC1918/ULA networks (covers Docker bridge networks,
  host loopback, and private LANs) without trusting anything else.
- **Direct Cloudflare exposure with no internal proxy**: set `TRUST_CLOUDFLARE=true`. The server fetches
  `https://www.cloudflare.com/ips-v4` and `…/ips-v6` on first startup, caches the list at `data/cloudflare-ips.json`,
  and refreshes it every 7 days. Combine with `TRUST_PROXY=loopback` if you also need health checks from the host.
- **Other deployments**: pass an explicit CSV of CIDRs, e.g. `TRUST_PROXY=10.0.0.0/8,192.168.0.0/16`.

`TRUST_CLOUDFLARE` only takes effect in production (`NODE_ENV=production`) and only when `TRUST_PROXY` is a CIDR list
(boolean/integer values are treated as authoritative). On Cloudflare fetch failure, the server falls back to a stale
cache when one exists, or proceeds with an empty CF list otherwise.

When configured, the real client IP is also attached to error/warn pino entries (visible in `error.log` and as a badge
in the Logs tab of the dashboard).

## Environment Variables

| Variable               | Required | Default           | Description                                                                                                                                                   |
|------------------------|----------|-------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `UPSTREAM_BASE_URL`    | Yes      | —                 | Upstream Anthropic-compatible API URL                                                                                                                         |
| `UPSTREAM_API_KEY`     | Yes      | —                 | Shared API key for the upstream service                                                                                                                       |
| `JWT_SECRET`           | Yes      | —                 | Secret for signing admin JWT tokens                                                                                                                           |
| `TOKEN_ENCRYPTION_KEY` | Yes      | —                 | AES-256-GCM key for API token encryption                                                                                                                      |
| `ADMIN_USERNAME`       | No       | `admin`           | Initial admin username (first startup only)                                                                                                                   |
| `ADMIN_PASSWORD`       | Yes      | —                 | Initial admin password (first startup only)                                                                                                                   |
| `PORT`                 | No       | `3000`            | Server port                                                                                                                                                   |
| `HOST`                 | No       | `0.0.0.0`         | Server bind address                                                                                                                                           |
| `DB_PATH`              | No       | `./data/proxy.db` | SQLite database path                                                                                                                                          |
| `TLS_CERT_PATH`        | No       | —                 | Path to TLS certificate (enables HTTPS)                                                                                                                       |
| `TLS_KEY_PATH`         | No       | —                 | Path to TLS private key                                                                                                                                       |
| `RATE_LIMIT_MAX`       | No       | `120`             | Max requests per window per IP                                                                                                                                |
| `RATE_LIMIT_WINDOW_MS` | No       | `60000`           | Rate limit window in milliseconds                                                                                                                             |
| `LOG_LEVEL`            | No       | `info`            | Pino log level (trace/debug/info/warn/error)                                                                                                                  |
| `LOG_DIR`              | No       | `./data/logs`     | Directory for log files                                                                                                                                       |
| `LOG_DETAILED_REQUEST` | No       | `false`           | Log full request bodies (debug)                                                                                                                               |
| `REQUEST_TIMEOUT_MS`   | No       | `300000`          | Upstream request timeout (5 minutes)                                                                                                                          |
| `TRUST_PROXY`          | No       | `false`           | Fastify `trustProxy`. Accepts `true`/`false`, integer hop count, or CSV of IPs/CIDRs (shorthands: `loopback`, `linklocal`, `uniquelocal`).                    |
| `TRUST_CLOUDFLARE`     | No       | `false`           | When `true` and `NODE_ENV=production`, fetch Cloudflare's IP ranges, cache at `data/cloudflare-ips.json`, refresh every 7 days, and merge with `TRUST_PROXY`. |

## API Endpoints

### Proxy (Bearer token auth)

| Method | Path              | Description                               |
|--------|-------------------|-------------------------------------------|
| `HEAD` | `/v1/messages`    | Liveness probe (no auth)                  |
| `POST` | `/v1/messages`    | Forward messages to upstream              |
| `GET`  | `/v1/oauth/usage` | Per-token plan/credit usage (Bearer auth) |

### Admin API (JWT cookie auth)

| Method   | Path                                              | Description                |
|----------|---------------------------------------------------|----------------------------|
| `POST`   | `/api/auth/login`                                 | Admin login                |
| `POST`   | `/api/auth/logout`                                | Admin logout               |
| `GET`    | `/api/auth/me`                                    | Current admin info         |
| `GET`    | `/api/users`                                      | List users                 |
| `POST`   | `/api/users`                                      | Create user                |
| `PATCH`  | `/api/users/:id`                                  | Update user                |
| `DELETE` | `/api/users/:id`                                  | Delete user                |
| `GET`    | `/api/users/:userId/tokens`                       | List user's tokens         |
| `POST`   | `/api/users/:userId/tokens`                       | Create token               |
| `DELETE` | `/api/tokens/:id`                                 | Revoke token               |
| `GET`    | `/api/users/:id/quota`                            | User quota status          |
| `GET`    | `/api/users/:id/quota-overrides`                  | List quota overrides       |
| `POST`   | `/api/users/:id/quota-overrides`                  | Create quota override      |
| `DELETE` | `/api/users/:id/quota-overrides/:oid`             | Delete quota override      |
| `GET`    | `/api/users/:id/credits`                          | User monthly credit status |
| `GET`    | `/api/users/:userId/credit-overrides`             | List credit overrides      |
| `POST`   | `/api/users/:userId/credit-overrides`             | Create credit override     |
| `DELETE` | `/api/users/:userId/credit-overrides/:overrideId` | Delete credit override     |
| `GET`    | `/api/usage/summary`                              | Usage summary stats        |
| `GET`    | `/api/usage/by-user`                              | Per-user usage breakdown   |
| `GET`    | `/api/request-logs`                               | Paginated request logs     |
| `GET`    | `/api/settings`                                   | Get settings               |
| `PATCH`  | `/api/settings`                                   | Update settings            |
| `GET`    | `/api/health`                                     | Health check               |

## Project Structure

```
src/
  server/              # Fastify backend
    index.ts           # Entry point
    config.ts          # Environment variable parsing
    db/
      connection.ts    # SQLite connection + admin seeding
      schema.ts        # DDL statements
      repositories/    # Data access layer
    lib/
      crypto.ts        # Token hashing & encryption
      usage-extractor.ts   # SSE stream token counting
      request-diagnostics.ts # Malformed request detection
    middleware/
      admin-auth.ts    # JWT cookie verification
      proxy-auth.ts    # Bearer token verification
      quota-check.ts   # Daily token quota enforcement
      rate-limit.ts    # Per-IP rate limiting
    routes/            # Route handlers
  web/                 # React SPA
    components/
      auth/            # Login page
      dashboard/       # Usage charts & stats
      layout/          # App shell & navigation
      logs/            # Request log viewer
      settings/        # App settings
      shared/          # Reusable UI components
      users/           # User & token management
    hooks/             # Data fetching hooks
    lib/               # API client & utilities
  shared/
    types.ts           # TypeScript interfaces shared between server & web
```

## Development

```bash
npm run dev           # Start server + web concurrently
npm run dev:server    # Server only (tsx watch, hot reload)
npm run dev:web       # Vite dev server only
npm run build         # Build web (Vite) + server (tsc)
npm start             # Run production build
npm run lint          # ESLint
npm test              # Vitest
```

## License

Private — not licensed for redistribution.
