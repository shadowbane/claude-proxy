# Monthly MiMo Credit Limit

Optional per-user monthly credit limit for `mimo-v2-pro` traffic, enforced
independently of `daily_token_quota`. Credits are the unit MiMo actually bills.

## Why

`mimo-v2-pro` bills every token type — `prompt_tokens`, `completion_tokens`,
`cache_creation_input_tokens`, and `cache_read_input_tokens` — at the full 2×
pro multiplier. Cache reads are **not** discounted, which means the existing
`daily_token_quota` (which sums only `prompt + completion`) under-reports true
cost by roughly 8× for Claude-Code-style traffic and cannot meaningfully protect
the shared Max-tier subscription budget.

See [`mimo-billing-investigation.md`](./mimo-billing-investigation.md) §5.2 for
the evidence behind this formula.

## Formula

For each request row in `request_logs`, `estimated_credits` is pre-computed by
`src/server/lib/credit-calculator.ts` using the per-model multiplier table from
the [MiMo Token Plan subscription docs](https://platform.xiaomimimo.com/#/docs/tokenplan/subscription):

| Model          | Multiplier | Notes                                                       |
|----------------|-----------:|-------------------------------------------------------------|
| `mimo-v2-pro`  |         2× | All token types, including cache reads. No Anthropic-style discount. |
| `mimo-v2-omni` |         1× | All token types, equivalent to raw token rate.              |
| `mimo-v2-tts`  |         0× | Free during public beta.                                    |
| anything else  |     `NULL` | Not computed — aggregations distinguish "unknown" from zero. |

```
estimated_credits = multiplier(model) × (prompt + completion + cache_creation + cache_read)
```

> **Note:** MiMo's pricing page also describes a 4× tier for `mimo-v2-pro`
> with a 256k–1M context window. The Token Plan subscription currently does not
> expose a way to opt into the 1M window, so we treat `mimo-v2-pro` as a flat
> 2×. If that changes, update `MIMO_MULTIPLIERS` and add a v3 backfill.

The monthly window usage is:

```sql
SELECT COALESCE(SUM(estimated_credits), 0)
FROM request_logs
WHERE user_id = ?
  AND datetime(created_at) >= datetime(?)
  AND estimated_credits IS NOT NULL
  AND status = 'success';
```

Rows on unknown models have `estimated_credits = NULL` and are excluded from
the sum by the `IS NOT NULL` guard, so typos or experimental model IDs never
silently burn through the credit limit.

## Priority Chain

```
Override > Per-user credit_limit > Global credit_limit_default > Unlimited
```

| Source             | Wins when…                                                                               |
|--------------------|-------------------------------------------------------------------------------------------|
| `override`         | A `credit_overrides` row is active for today (covers the highest-priority slot)          |
| `user`             | No active override; `users.credit_limit` is a non-null non-`-1` value                    |
| `default`          | No active override; `users.credit_limit` is `null`; `settings.credit_limit_default` set  |
| `none` (unlimited) | Nothing above applies, or `users.credit_limit = -1`, or `credit_limit_default = -1`       |

Value semantics on `users.credit_limit`:

| `users.credit_limit` | `settings.credit_limit_default` | Effective (assuming no override)    |
|----------------------|---------------------------------|-------------------------------------|
| `null`               | *(unset)*                       | Unlimited                           |
| `null`               | `-1`                            | Unlimited                           |
| `null`               | positive integer                | Global default                      |
| `-1`                 | anything                        | Explicit unlimited (beats default)  |
| positive integer     | anything                        | Per-user value                      |
| `0`                  | anything                        | Blocks all credited-model requests  |

## Window

The window is monthly, aligned to an admin-chosen reset day at 00:00 UTC.

- `credit_reset_day` setting: integer day of month, `1`–`28`. Values outside that
  range are clamped on read so every month has a valid reset day. Default: `1`.
- If the current UTC time is on or after this month's reset-day midnight, the
  window started this month. Otherwise it started on the previous month's reset
  day.

Worked examples (UTC):

| `credit_reset_day` | Now                       | Window start       | Window end         |
|--------------------|---------------------------|--------------------|--------------------|
| `1`                | `2026-04-18 13:00:00`     | `2026-04-01 00:00` | `2026-05-01 00:00` |
| `1`                | `2026-04-01 00:00:00`     | `2026-04-01 00:00` | `2026-05-01 00:00` |
| `1`                | `2026-03-31 23:59:59.999` | `2026-03-01 00:00` | `2026-04-01 00:00` |
| `15`               | `2026-04-14 23:59:00`     | `2026-03-15 00:00` | `2026-04-15 00:00` |
| `15`               | `2026-04-15 00:00:00`     | `2026-04-15 00:00` | `2026-05-15 00:00` |
| `28`               | `2026-02-28 12:00:00`     | `2026-02-28 00:00` | `2026-03-28 00:00` |
| `28`               | `2026-02-27 23:59:00`     | `2026-01-28 00:00` | `2026-02-28 00:00` |
| `28`               | `2024-02-29 10:00:00` (leap) | `2024-02-28 00:00` | `2024-03-28 00:00` |

## Relationship to `daily_token_quota`

Both limits are enforced **independently**. The preHandler chain is:

```
proxyAuth → quotaCheck → creditCheck → forwardMessages
```

When both are tripped, `quotaCheck` fires first and its 429 body is returned.
When only one is tripped, that check's body is returned. A user can set one, the
other, both, or neither.

Rule of thumb:

- `daily_token_quota` — smooths burst / short-window fairness (Anthropic-style,
  cache excluded).
- `credit_limit` — protects the actual monthly MiMo billing envelope (2×, cache
  included).

## Overrides

Admins can create date-range overrides that temporarily change a user's credit
cap. While one is active, it beats both the per-user `credit_limit` and the
global default.

| Field         | Description                                                      |
|---------------|------------------------------------------------------------------|
| `start_date`  | First day the override is active (`YYYY-MM-DD`, UTC)             |
| `end_date`    | Last day the override is active (`YYYY-MM-DD`, UTC, inclusive)   |
| `max_credits` | Credit cap while active. `0` blocks all credited-model usage.    |
| `note`        | Optional admin note                                              |

**Activation check — differs from daily-quota overrides.** For daily
`quota_overrides` the check is against the *current quota window's* start date.
For `credit_overrides` the check is against **today's UTC date**. The
monthly credit window can span 30+ days, so evaluating against the window
start would mean any mid-month override never activates. Checking today's
date matches the admin's "active right now" mental model.

**Precedence when multiple overrides overlap.** The most recently created
override wins (`ORDER BY created_at DESC LIMIT 1`). Inclusive on both
endpoints — a single-day override with `start_date = end_date = '2026-04-20'`
is active throughout UTC `2026-04-20`.

**Expiry.** Past-dated overrides are simply ignored by the activation check;
they remain in the table for audit.

## Database Schema

### `users` table — new column

```sql
credit_limit INTEGER DEFAULT NULL  -- null = use global default, -1 = explicit unlimited
```

Migration is applied on startup in `src/server/db/connection.ts`:

```ts
try { _db.exec('ALTER TABLE users ADD COLUMN credit_limit INTEGER DEFAULT NULL'); } catch { /* exists */ }
```

### `credit_overrides` table

```sql
CREATE TABLE credit_overrides (
  id          TEXT PRIMARY KEY,
  user_id     TEXT    NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  start_date  TEXT    NOT NULL,  -- YYYY-MM-DD
  end_date    TEXT    NOT NULL,  -- YYYY-MM-DD, inclusive
  max_credits INTEGER NOT NULL,
  note        TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_credit_overrides_user_dates
  ON credit_overrides (user_id, start_date, end_date);
```

`ON DELETE CASCADE` — deleting a user wipes their credit overrides.

### `settings` table — new keys

| Key                    | Value                                      | Default  |
|------------------------|--------------------------------------------|----------|
| `credit_limit_default` | `-1` (unlimited) or non-negative integer   | *(none, = unlimited)* |
| `credit_reset_day`     | Integer `1`–`28`                           | `1`      |

## API Endpoints

### Credit Status

```
GET /api/users/:id/credits
```

Returns:

```json
{
  "credit_limit": 100000000,
  "credit_source": "user",
  "credits_used": 42350000,
  "credits_remaining": 57650000,
  "window_start": "2026-04-01 00:00:00",
  "window_end": "2026-05-01 00:00:00",
  "reset_day": 1
}
```

`credit_source` is `"override"`, `"user"`, `"default"`, or `"none"` (unlimited).
When an override is active, the response also includes `"override_id"`.

### Credit Overrides

```
GET    /api/users/:userId/credit-overrides                 — list all overrides
POST   /api/users/:userId/credit-overrides                 — create override
DELETE /api/users/:userId/credit-overrides/:overrideId     — delete override
```

`POST` body:

```json
{
  "start_date": "2026-04-15",
  "end_date": "2026-04-30",
  "max_credits": 50000000,
  "note": "launch week"
}
```

Validation: dates are `YYYY-MM-DD`, `end_date >= start_date`, `max_credits` is
a non-negative integer (`0` is allowed to freeze the user).

### User Create/Update

`credit_limit` is accepted on both `POST /api/users` and `PUT /api/users/:id`:

```json
{ "name": "Alice", "daily_token_quota": 1000000, "credit_limit": 50000000 }
```

Values: positive integer (custom limit), `-1` (explicit unlimited), `null`
(inherit global default).

### Settings

```
PUT /api/settings
{ "credit_limit_default": "100000000", "credit_reset_day": "15" }
```

Validation:

- `credit_limit_default`: integer string ≥ `-1`. Empty string removes the
  setting (reverts to unlimited). Non-numeric values return 400.
- `credit_reset_day`: integer string in `[1, 28]`. Empty string removes the
  setting (reverts to default `1`). Out-of-range returns 400.

## Proxy Enforcement

When blocked, the 429 response includes both a human-readable message and a
machine-readable `credits` object:

```json
{
  "error": {
    "message": "Monthly credit limit exceeded. Used 105,000,000 of 100,000,000 credits. Resets at 2026-05-01 00:00:00 UTC.",
    "type": "credit_limit_exceeded"
  },
  "credits": {
    "credit_limit": 100000000,
    "credit_source": "user",
    "credits_used": 105000000,
    "credits_remaining": 0,
    "window_start": "2026-04-01 00:00:00",
    "window_end": "2026-05-01 00:00:00",
    "reset_day": 1
  }
}
```

Error `type` is `credit_limit_exceeded` (distinct from `quota_exceeded` and
`rate_limit_error`).

Semantics match `daily_token_quota`: a request that pushes usage over the limit
still completes; the *next* request is blocked. The comparison is
`credits_used < credit_limit` — exact-equality (`used == limit`) blocks.

## Frontend

- **Settings > Quotas tab**: two sections — Daily Token Quota (existing) and
  Monthly MiMo Credit Limit (default + reset day).
- **Add/Edit User modals**: a second dropdown (`Use global default` / `Custom
  limit` / `Unlimited`) plus number input, grouped under "Monthly MiMo Credit
  Limit" and editable independently of the daily quota.
- **User detail page**: side-by-side `QuotaStatusCard` and `CreditStatusCard`
  with progress bar (green < 75%, yellow 75–90%, red ≥ 90%) and the next reset
  timestamp. The credit card shows an `Override Active` badge when a row in
  `credit_overrides` applies today.
- **Credit Overrides table**: sits next to the Quota Overrides table on the
  user detail page. Each row shows the date range, max credits, note, and an
  `Active` chip when today's UTC date falls in range. Delete inline; add via
  the `CreditOverrideModal` form.

## Operational Runbook

### Set a per-user credit limit

1. Admin dashboard → Users → click the user → **Edit**.
2. Under *Monthly MiMo Credit Limit*, pick **Custom limit** and enter the
   ceiling in credits (e.g. `100000000` ≈ 50M `mimo-v2-pro` tokens with the 2×
   multiplier).
3. Save. The card on the user detail page refreshes immediately.

### Change the global default

1. Admin dashboard → Settings → **Quotas**.
2. Set *Global Default Limit* under *Monthly MiMo Credit Limit* to the
   desired integer or leave empty for unlimited. Use `-1` to make "unlimited"
   explicit (useful when users will otherwise inherit a non-null value later).
3. Save.

### Grant a temporary override

Use case: a user's monthly cap is 100M credits but they need a one-off bump
for a launch week without permanently raising their limit.

1. Admin dashboard → Users → click the user → **+ Add Override** under
   *Credit Overrides*.
2. Pick `start_date` and `end_date` (inclusive, UTC). The override activates
   as soon as today's UTC date enters the range.
3. Enter `max_credits` and an optional note. Save.
4. The `CreditStatusCard` now shows an `Override Active` badge; the 429 error
   body will include `"credit_source": "override"` and `"override_id"` if the
   user trips it.
5. Remove with the *Delete* link in the overrides table. The old entry is
   permanently removed — there is no archive; if you need audit history use
   git blame on the note column or snapshot the DB before deletion.

### Change the reset day

1. Admin dashboard → Settings → **Quotas** → *Monthly Reset Day (UTC)*,
   integer 1–28. Save.
2. The next call to `GET /api/users/:id/credits` uses the new reset day.
   Requests in-flight during the change are unaffected.

Changing the reset day shifts the window boundary in place — it does not reset
current accumulated usage. Usage already inside the new window continues to
count; usage now *outside* the new window drops out of the sum naturally.

### What a blocked user sees

Their API client receives an HTTP `429` with the body shape above. `credits.window_end`
tells them exactly when the window rolls over.

## Tests

| File                                | Covers                                                    |
|-------------------------------------|-----------------------------------------------------------|
| `tests/credit-calculator.test.ts`      | Per-model multiplier table (pro=2×, omni=1×, tts=0), unknown-model → null, case-sensitivity, negative/NaN/Infinity coercion |
| `tests/credit-repo.test.ts`            | `computeWindowStart` boundary/leap-year/rollover cases, `getCreditResetDay` clamp/fallback, `getCreditsUsedInWindow` null/zero/boundary/error-status exclusion, `getEffectiveCreditLimit` priority chain, `checkCreditLimit` at `<`/`=`/`>` limit, **override CRUD**, **override activation** (in-range/out-of-range/boundary inclusive/latest-created-wins/cross-user isolation), **priority with override** (beats per-user and global default, expired falls through, `max_credits=0` freezes) |
| `tests/credit-check.test.ts`           | Proxy `/v1/messages` 429 with correct shape, coexistence ordering with `daily_token_quota`, global default path, **end-to-end per-model accrual** (pro→2×, omni→1×, tts→0, unknown→null), omni tripping the limit, tts never accumulating, **override raises/lowers limit**, **expired override ignored**, **override=0 freezes** |
| `tests/credit-overrides-routes.test.ts`| GET/POST/DELETE CRUD, 404 on missing user/override, 401 without auth, YYYY-MM-DD format validation, `end_date >= start_date`, `max_credits` non-negative integer (allows 0), newest-first ordering, cascade on user delete |
| `tests/backfill.test.ts`               | `backfillMultiModelCredits` fills omni at 1× and tts at 0; leaves pro and unknown rows alone; v2 flag is idempotent and separate from v1 |
| `tests/user-repo.test.ts`           | `credit_limit` persistence, null / positive / `-1` round-trip, independence from `daily_token_quota` |
| `tests/user-routes.test.ts`         | `GET /api/users/:id/credits` 200/404/401                  |
| `tests/settings-routes.test.ts`     | `credit_reset_day` and `credit_limit_default` validation, empty-string removal |

## Files

| File                                              | Purpose                                                       |
|---------------------------------------------------|---------------------------------------------------------------|
| `src/server/db/repositories/credit.ts`            | Window math, usage sum, priority chain, override CRUD, enforcement check |
| `src/server/middleware/credit-check.ts`           | Fastify preHandler that calls `checkCreditLimit()`            |
| `src/server/routes/users.ts`                      | `GET /api/users/:id/credits` + accepts `credit_limit`         |
| `src/server/routes/credit-overrides.ts`           | Admin API for credit override CRUD                            |
| `src/server/routes/settings.ts`                   | Validates `credit_limit_default` and `credit_reset_day`       |
| `src/server/lib/credit-calculator.ts`             | `MIMO_MULTIPLIERS` table + `estimateCredits()`                |
| `src/server/db/backfill.ts`                       | v1 (pro) and v2 (omni/tts) historical backfills               |
| `src/server/db/schema.ts`                         | `users.credit_limit` column                                   |
| `src/server/db/connection.ts`                     | Defensive `ALTER TABLE` migration + one-shot backfill runners |
| `src/shared/types.ts`                             | `User.credit_limit`, `CreditStatus` interface                 |
| `src/web/hooks/useCredits.ts`                     | Fetches credit status                                         |
| `src/web/hooks/useCreditOverrides.ts`             | CRUD hook for credit overrides                                |
| `src/web/components/users/CreditStatusCard.tsx`   | Progress bar + status display (with "Override Active" badge)  |
| `src/web/components/users/CreditOverrideModal.tsx`| Create credit override form                                   |
| `src/web/components/users/AddUserModal.tsx`       | Credit-limit dropdown + input on user creation                |
| `src/web/components/users/EditUserModal.tsx`      | Credit-limit dropdown + input on user edit                    |
| `src/web/components/users/UserDetailPage.tsx`     | Renders both status cards + both overrides tables             |
| `src/web/components/settings/QuotasTab.tsx`       | Global default + reset-day inputs                             |
