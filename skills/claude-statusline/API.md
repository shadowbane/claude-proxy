# Plan-usage API specification (claude-proxy)

The statusline polls `GET /api/oauth/usage` on the claude-proxy and caches the response to `~/.claude/cache/plan-usage.json`. The proxy reuses the Anthropic-compatible path so `ANTHROPIC_BASE_URL` carries through automatically.

## Request

```
GET {endpoint}
Authorization: Bearer {token}
Accept: application/json
User-Agent: claude-code/statusline-poller
anthropic-beta: oauth-2025-04-20        # proxy ignores this; omit via CLAUDE_USAGE_BETA=""
```

- `{endpoint}` — resolved in this order: `CLAUDE_USAGE_ENDPOINT` → `${ANTHROPIC_BASE_URL}/api/oauth/usage` → `https://api.anthropic.com/api/oauth/usage`.
- `{token}` — resolved in this order: `CLAUDE_USAGE_TOKEN` → `ANTHROPIC_AUTH_TOKEN` → `~/.claude/.credentials.json` (`.claudeAiOauth.accessToken`) → macOS Keychain (`Claude Code-credentials`). For claude-proxy, this is the same API token used for `/v1/messages`.
- Query string: none.
- Body: none.

## Response (HTTP 200)

Content-Type: `application/json`.

```json
{
  "five_hour": {
    "utilization": 27.3,
    "resets_at": "2026-04-18T00:00:00+00:00"
  },
  "leaderboard": {
    "rank": 3,
    "total_users": 12,
    "tokens_used_today": 45231
  }
}
```

Notes for this build:
- `five_hour` maps to the proxy's **daily quota window**, not a 5-hour window. The key name is kept for compatibility with the upstream Anthropic contract. The statusline label says `day`.
- There is no `seven_day` field — the proxy doesn't track a weekly window, so the key is omitted entirely.
- `leaderboard` is a claude-proxy extension: the caller's position across all proxy users by today's (input + output) token total. `rank: null` when the user has zero tokens today.

### Fields the statusline reads

| Field | Type | Required | Notes |
|---|---|---|---|
| `five_hour.utilization`   | number (0–100) or null | **yes** | Percentage of the daily quota consumed. Null hides the daily row (unlimited user). |
| `five_hour.resets_at`     | RFC 3339 UTC string | recommended | Window end. If null, the statusline drops the "resets …" suffix. |
| `leaderboard.rank`        | integer ≥ 1 or null | optional | Renders as `♛ rank #N / M` on the right side of line 4. |
| `leaderboard.total_users` | integer ≥ 0 | optional | Denominator for the rank display. |

### Timestamp format

`resets_at` must be ISO 8601 / RFC 3339 with an explicit timezone, e.g. `2026-04-17T07:00:00+00:00`. The statusline strips fractional seconds and parses up to `%Y-%m-%dT%H:%M:%S`, treating the value as UTC. Do **not** send a naive local-time string.

## Error responses

Any non-200 status causes the poller to exit 1 without updating the cache (the statusline continues showing the previous value).

- `401 Unauthorized` — invalid/expired/disabled API token. Check that your `ANTHROPIC_AUTH_TOKEN` is still active on the proxy.
- `403 Forbidden` — user account is disabled on the proxy.
- `5xx` — transient; next poll (~2 min later) retries.

## Cache file shape (what the statusline actually reads)

`~/.claude/cache/plan-usage.json` = the response body with an extra key:

```json
{
  "five_hour": { ... },
  "leaderboard": { ... },
  "fetched_at": 1776403935
}
```

`fetched_at` is a Unix timestamp (seconds) written by the poller and used to drive the 2-minute self-refresh.
