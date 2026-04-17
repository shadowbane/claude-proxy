# Request Logging

Every proxied `/v1/messages` request produces exactly one row in the
`request_logs` table. This doc describes the write path, the semantics of
each column, and the SQLite tuning that keeps logging off the hot path.

## Write Path

`src/server/routes/proxy.ts` writes the log row **after** the upstream
response has been streamed to the client and usage has been parsed — a
single `INSERT`, no subsequent `UPDATE`. This halves the per-request
SQLite write count and keeps `latency_ms` accurate (measured at end of
response rather than at the start).

Three terminal branches, one INSERT each:

| Branch                          | `status`  | When                                             | Token columns                               |
|---------------------------------|-----------|--------------------------------------------------|---------------------------------------------|
| Upstream returned non-2xx       | `error`   | `!upstream.ok`                                   | `0, 0, 0, 0`                                |
| Exception before/during stream  | `error`   | `fetch` throws, timeout, client disconnect, etc. | `0, 0, 0, 0`                                |
| Response streamed to completion | `success` | Stream drained, usage extracted                  | Parsed from upstream SSE/JSON, `null` → `0` |

The log is written **after** `reply.raw.end()`, so logging never blocks
the client-facing response.

## Token Extraction

Response chunks are teed into an in-memory buffer capped at **256 KiB**
(`USAGE_BUFFER_MAX`). Once streaming completes, `extractUsage()` parses
either:

- **SSE** (`text/event-stream`) — accumulates `message_start` and
  `message_delta` events and sums their `usage` objects.
- **JSON** (`application/json`) — reads the top-level `usage` block.

If the response exceeds the cap, extraction is skipped and the row is
written with `0, 0, 0, 0`. This is rare in practice — usage is announced
in the first and last SSE events, which fit well under 256 KiB.

### Column Semantics

| Column                        | Source                                                 | Notes                        |
|-------------------------------|--------------------------------------------------------|------------------------------|
| `prompt_tokens`               | `usage.input_tokens`                                   | Billed input                 |
| `completion_tokens`           | `usage.output_tokens`                                  | Billed output                |
| `cache_creation_input_tokens` | `usage.cache_creation_input_tokens`                    | Not counted toward quota     |
| `cache_read_input_tokens`     | `usage.cache_read_input_tokens`                        | Not counted toward quota     |
| `latency_ms`                  | `performance.now()` at INSERT time                     | Full request-to-response-end |
| `status`                      | `success` / `error`                                    | See table above              |
| `error_message`               | Upstream body (truncated 500 chars) or `Error.message` | Null on success              |
| `client_ip`                   | `request.ip` (Fastify)                                 |                              |

## Concurrency and Quota Reads

The log row for a successful request is visible to other queries only
**after the response finishes streaming**. The daily-quota middleware
(`src/server/middleware/quota-check.ts`) sums tokens from completed rows
only, so in-flight requests are never double-counted.

A user firing concurrent requests can momentarily exceed their quota
by the cost of the in-flight request, same as described in
`docs/daily-quota.md`: "a request that pushes usage over the limit will
still complete — the next request is blocked."

## SQLite Tuning

Applied per connection in `src/server/db/connection.ts`:

| PRAGMA         | Value       | Why                                                                |
|----------------|-------------|--------------------------------------------------------------------|
| `journal_mode` | `WAL`       | Readers never block writers; fewer fsyncs on commit                |
| `synchronous`  | `NORMAL`    | Safe with WAL; ~2–3× faster writes than `FULL`                     |
| `busy_timeout` | `5000`      | Tolerate brief lock contention instead of returning `SQLITE_BUSY`  |
| `cache_size`   | `-20000`    | ~20 MiB page cache per connection                                  |
| `temp_store`   | `MEMORY`    | Sorts and intermediate tables stay off disk                        |
| `mmap_size`    | `268435456` | 256 MiB memory-mapped reads; speeds up analytics on `request_logs` |
| `foreign_keys` | `ON`        | Enforce FKs (`user_id`, `token_id` → `users`, `api_tokens`)        |

`better-sqlite3` is synchronous by design, so these PRAGMAs matter: the
goal is to minimize the time the event loop is blocked on each INSERT.
In practice, a single WAL-mode INSERT with `synchronous=NORMAL` takes
sub-millisecond on a local SSD.

## Log Retention

Log file rotation (`app.log`, `error.log`) is handled by
`src/server/lib/log-cleaner.ts` on a schedule. The `request_logs` **table**
is not auto-pruned — rows accumulate indefinitely. If the table grows
large enough to affect analytics query latency, add a retention policy
(e.g., delete rows older than N days) in the same scheduler.

## Schema

Indices on `request_logs`:

- `idx_request_logs_created (created_at)` — powers time-series and recent-activity queries
- `idx_request_logs_user_id (user_id)` — per-user filters
- `idx_request_logs_user_created (user_id, created_at)` — quota window sums

Full DDL in `src/server/db/schema.ts`.
