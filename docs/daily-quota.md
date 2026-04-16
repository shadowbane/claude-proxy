# Daily Token Quota

Per-user daily token quotas with configurable reset time, date-range overrides, and proxy enforcement.

## How It Works

1. A **global default limit** can be set in Settings — applies to all users without a per-user quota
2. Each user can have a per-user `daily_token_quota`: a custom limit, explicitly unlimited (`-1`), or `null` to inherit the global default
3. Before every proxy request, the middleware sums the user's tokens consumed in the current quota window
4. If usage >= limit, the request is rejected with **429** (`type: quota_exceeded`)
5. A request that pushes usage over the limit will still complete — the *next* request is blocked (token counts are only
   known after streaming)

### Priority Chain

```
Override > Per-user quota > Global default > Unlimited
```

- **Override**: Temporary date-range limit (highest priority)
- **Per-user custom limit**: `daily_token_quota` set to a positive integer
- **Per-user unlimited**: `daily_token_quota = -1` — explicitly bypasses global default
- **Global default**: `quota_default_limit` setting — applies when user has `null`
- **Unlimited**: No limit configured anywhere

### What Counts as Tokens

Input and output tokens from successful requests:

```
prompt_tokens + completion_tokens
```

Cache tokens (`cache_creation_input_tokens`, `cache_read_input_tokens`) are **not** counted toward the quota. Only `status = 'success'` requests count. Error requests are excluded.

## Quota Window

The quota "day" is defined by a global reset time stored in settings (`quota_reset_time`, default `00:00` UTC).

- If reset is `06:00` and current UTC time is `10:00` → window is today 06:00 to tomorrow 06:00
- If reset is `06:00` and current UTC time is `03:00` → window is yesterday 06:00 to today 06:00

Configure via **Settings > Quota Settings** in the admin dashboard.

## Overrides

Admins can create date-range overrides to temporarily change a user's daily limit.

| Field        | Description                                             |
|--------------|---------------------------------------------------------|
| `start_date` | First day the override is active (YYYY-MM-DD)           |
| `end_date`   | Last day the override is active (YYYY-MM-DD, inclusive) |
| `max_tokens` | Override daily limit. Use `0` to block all usage        |
| `note`       | Optional admin note                                     |

**Priority**: Override takes precedence over the user's `daily_token_quota`. When multiple overrides overlap, the most
recently created one wins.

**Expiry**: The override's date range is evaluated against the quota window's start date. If the window starts on
`2026-04-17` and the override's `end_date` is `2026-04-16`, the override no longer applies.

## Database Schema

### `users` table — new column

```sql
daily_token_quota INTEGER DEFAULT NULL  -- null = use global default, -1 = explicitly unlimited
```

### `quota_overrides` table

```sql
CREATE TABLE quota_overrides
(
    id         TEXT PRIMARY KEY,
    user_id    TEXT    NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    start_date TEXT    NOT NULL, -- YYYY-MM-DD
    end_date   TEXT    NOT NULL, -- YYYY-MM-DD inclusive
    max_tokens INTEGER NOT NULL,
    note       TEXT,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_quota_overrides_user_dates
    ON quota_overrides (user_id, start_date, end_date);
```

### `settings` table — new key

| Key                    | Value                | Default  |
|------------------------|----------------------|----------|
| `quota_reset_time`     | `HH:MM` (24h UTC)    | `00:00`  |
| `quota_default_limit`  | Non-negative integer | *(none)* |

## API Endpoints

### Quota Status

```
GET /api/users/:id/quota
```

Returns:

```json
{
    "quota_limit": 1000000,
    "quota_source": "user",
    "tokens_used": 425000,
    "tokens_remaining": 575000,
    "window_start": "2026-04-16 00:00:00",
    "window_end": "2026-04-17 00:00:00"
}
```

`quota_source` is `"user"` (per-user quota), `"override"` (active override), `"default"` (global default), or `"none"` (unlimited).
When an override is active, `override_id` is included.

### Quota Overrides

```
GET    /api/users/:userId/quota-overrides         — list all overrides
POST   /api/users/:userId/quota-overrides         — create override
DELETE /api/users/:userId/quota-overrides/:id      — delete override
```

POST body:

```json
{
    "start_date": "2026-04-15",
    "end_date": "2026-04-20",
    "max_tokens": 5000000,
    "note": "conference week"
}
```

### User Create/Update

`daily_token_quota` is accepted in `POST /api/users` and `PUT /api/users/:id`:

```json
{
    "name": "Alice",
    "daily_token_quota": 1000000
}
```

Values: positive integer (custom limit), `-1` (explicitly unlimited), `null` (use global default).

### Settings

```
PUT /api/settings
{ "quota_reset_time": "06:00", "quota_default_limit": "5000000" }
```

- `quota_reset_time`: validated as `HH:MM` with hours 00-23 and minutes 00-59
- `quota_default_limit`: non-negative integer string; omit or remove to have no global default

## Proxy Enforcement

The enforcement happens as a Fastify `preHandler` in the proxy route chain:

```
proxyAuth → quotaCheck → forwardMessages
```

When blocked, the 429 response includes both a human-readable message and a machine-readable `quota` object:

```json
{
    "error": {
        "message": "Daily token quota exceeded. Used 1,050,000 of 1,000,000 tokens. Resets at 2026-04-17 00:00:00 UTC.",
        "type": "quota_exceeded"
    },
    "quota": {
        "quota_limit": 1000000,
        "quota_source": "user",
        "tokens_used": 1050000,
        "tokens_remaining": 0,
        "window_start": "2026-04-16 00:00:00",
        "window_end": "2026-04-17 00:00:00"
    }
}
```

The error `type` is `quota_exceeded` (distinct from the rate-limiter's `rate_limit_error`).

## Frontend

- **Settings page**: Global default limit + quota reset time picker (UTC)
- **Add/Edit User modals**: Dropdown (Use global default / Custom limit / Unlimited) + number input
- **Users list**: Quota column showing limit or "Unlimited"
- **User detail page**: Quota status card with progress bar (green < 75%, yellow 75-90%, red > 90%), overrides table
  with add/delete

## Files

| File                                              | Purpose                                                       |
|---------------------------------------------------|---------------------------------------------------------------|
| `src/server/db/repositories/quota.ts`             | Window calculation, usage queries, override CRUD, enforcement |
| `src/server/middleware/quota-check.ts`            | Fastify preHandler that calls `checkQuota()`                  |
| `src/server/routes/quota-overrides.ts`            | Admin API routes for override CRUD                            |
| `src/web/hooks/useQuota.ts`                       | Fetches quota status                                          |
| `src/web/hooks/useQuotaOverrides.ts`              | CRUD hook for overrides                                       |
| `src/web/components/users/QuotaStatusCard.tsx`    | Progress bar + status display                                 |
| `src/web/components/users/QuotaOverrideModal.tsx` | Create override form                                          |
| `tests/quota-repo.test.ts`                        | 21 unit tests for quota repository                            |
| `tests/quota-check.test.ts`                       | 6 integration tests for proxy enforcement                     |
| `tests/quota-overrides-routes.test.ts`            | 18 route + validation tests                                   |
