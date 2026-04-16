# Claude-Proxy: Project Structure

```
claude-proxy/
  docs/
    architecture.md              # System design & database schema
    project-structure.md         # This file
    implementation-plan.md       # Phased implementation plan
  src/
    server/
      index.ts                   # Fastify entry point, plugin registration
      config.ts                  # Environment variable parsing
      db/
        connection.ts            # SQLite singleton (WAL mode, foreign keys)
        schema.ts                # DDL statements + default seeding
        repositories/
          admin.ts               # Admin CRUD
          user.ts                # User CRUD
          api-token.ts           # Token create/lookup/revoke/reveal
          request-log.ts         # Request log CRUD + analytics queries
          settings.ts            # Key-value settings store
      lib/
        crypto.ts                # bcrypt, AES-256-GCM, SHA-256, token generation
        usage-extractor.ts       # Anthropic SSE/JSON token count extraction
        request-diagnostics.ts   # Tool-use sanitization (defensive)
      middleware/
        admin-auth.ts            # JWT verification for /api/* routes
        proxy-auth.ts            # Bearer token verification for /v1/* routes
        error-handler.ts         # Global error handler
        rate-limit.ts            # Rate limiting
      routes/
        auth.ts                  # /api/auth/* (login, logout, me, change-password)
        users.ts                 # /api/users/* (CRUD)
        tokens.ts                # /api/tokens/* (revoke, update, reveal)
        usage.ts                 # /api/usage/* (analytics)
        request-logs.ts          # /api/logs/* (paginated logs)
        settings.ts              # /api/settings/*
        proxy.ts                 # /v1/messages (forward to upstream)
    web/
      index.html
      main.tsx
      App.tsx
      styles/
        globals.css
      lib/
        api.ts                   # Fetch wrapper with cookie auth
        date-range.ts            # Date utilities for analytics
      hooks/
        useAuth.ts
        useUsers.ts
        useUserTokens.ts
        useUsage.ts
        useUserUsage.ts
        useRequestLogs.ts
        useSettings.ts
      components/
        layout/
          Sidebar.tsx
          Header.tsx
          AuthGuard.tsx          # Redirect to login if no session
        auth/
          LoginPage.tsx
        users/
          UsersPage.tsx
          UserDetailPage.tsx
          AddUserModal.tsx
          EditUserModal.tsx
        tokens/
          TokenList.tsx
          CreateTokenModal.tsx   # Shows raw token once with copy button
        usage/
          UsageDashboard.tsx
          UsageChart.tsx         # Reusable Recharts time-series
        logs/
          LogsPage.tsx
          Pagination.tsx
        settings/
          SettingsPage.tsx
        shared/
          ConfirmDialog.tsx
          StatusBadge.tsx
          DateRangeBar.tsx
          StatCard.tsx
    shared/
      types.ts                   # Shared TypeScript interfaces
  docker/
    Dockerfile
    docker-compose.yml
  .env.example
  .gitignore
  package.json
  tsconfig.json
  tsconfig.server.json
  tsconfig.web.json
  vite.config.ts
  tailwind.config.ts
  postcss.config.js
  eslint.config.js
```
