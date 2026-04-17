---
name: claude-statusline
description: Install a multi-line, right-aligned Claude Code statusline for users of this claude-proxy instance. Shows dir/branch, token usage, context %, model, daily quota utilization, and the proxy's leaderboard rank. Self-refreshes every ~2 min while Claude Code is open — no OS-level scheduler.
tags:
  - claude-code
  - statusline
  - claude-proxy
---

# Claude Code Statusline (claude-proxy build)

Renders a 4-line, right-aligned statusline:

```
                                                      ▸ repo-name ⎇ branch
                                 ↑347  ↓109,115  Σ109,462        ◐ 12% / 1M
                         ◆ 11,323,554  Σ11,432,016    ⌬ Opus 4.7 (1M context)
                              ⧗ day 27% · resets 14h   ♛ rank #3 / 12
```

- Line 1: current directory and git branch (if any).
- Line 2: cumulative input / output / IO total across the session + context used %.
- Line 3: cumulative cache tokens + grand total + model name.
- Line 4: daily quota usage (from the proxy's daily window) + your leaderboard rank among all users on this proxy.

Daily quota and leaderboard come from `GET /api/oauth/usage` on the proxy — see **API.md** for the exact contract.

## How it works with claude-proxy

The proxy exposes `/api/oauth/usage` using the same Bearer token you already use for `/v1/messages`. If you've set the standard Claude Code env vars:

```bash
export ANTHROPIC_BASE_URL="https://your-claude-proxy.example.com"
export ANTHROPIC_AUTH_TOKEN="your-api-token"
```

then the poller picks both up automatically — **no extra config needed**. The statusline label says `day` (not `5h`) because the proxy enforces a rolling daily quota window, not Anthropic's 5-hour window.

The proxy also returns a `leaderboard` field with your rank by today's total (input + output) token usage across all proxy users. That's rendered on the right side of line 4 as `♛ rank #N / M`.

## Files in this skill

| File | Purpose |
|---|---|
| `statusline.sh` | Renderer. Reads statusline JSON from stdin + the cache file. Self-refreshes the plan-usage cache when older than 2 min via a fire-and-forget background `fetch-plan-usage.sh` call (mkdir-based lock prevents stampedes). Cross-platform (BSD + GNU date). |
| `fetch-plan-usage.sh` | Poller. Resolves endpoint + bearer token (see config table), hits the endpoint, writes `~/.claude/cache/plan-usage.json` atomically with a `fetched_at` timestamp. |
| `install.sh` | One-shot installer. Copies files, primes the cache, wires `statusLine` into `~/.claude/settings.json`. |
| `API.md` | Full request/response spec for `/api/oauth/usage`. |

## How the refresh works

The statusline runs on every Claude Code status re-render. On each run it reads `fetched_at` from the cache file; if the cache is older than `stale_after` (default 120 s), it launches `fetch-plan-usage.sh` in the background and keeps rendering with whatever data is already on disk. The next render after curl returns picks up the fresh values.

An mkdir-based lock (`~/.claude/cache/plan-usage.lock`) prevents concurrent refreshes when multiple Claude Code sessions (or rapid re-renders) trigger at once.

## Configuration

All env vars are optional. Persist them in `~/.claude/.statusline-env` (the poller sources this file) or pass to `install.sh`.

| Var | Default | Purpose |
|---|---|---|
| `CLAUDE_USAGE_ENDPOINT` | *(auto)* | Explicit override. Skips endpoint fallbacks below. |
| `CLAUDE_USAGE_TOKEN` | *(auto)* | Explicit bearer token. Skips token fallbacks below. |
| `CLAUDE_USAGE_BETA` | `oauth-2025-04-20` | Value of the `anthropic-beta` header. The proxy ignores it; set to empty to omit. |

Endpoint fallback chain when `CLAUDE_USAGE_ENDPOINT` is unset:
1. `${ANTHROPIC_BASE_URL}/api/oauth/usage` — **the common case for proxy users**.
2. `https://api.anthropic.com/api/oauth/usage`.

Token fallback chain when `CLAUDE_USAGE_TOKEN` is unset:
1. `ANTHROPIC_AUTH_TOKEN` — **the common case for proxy users**.
2. `~/.claude/.credentials.json` → `.claudeAiOauth.accessToken`.
3. macOS Keychain: `security find-generic-password -s "Claude Code-credentials" -w` → `.claudeAiOauth.accessToken`.

## How to install

1. Check deps: `jq`, `curl`, `git`, `bash`. Install missing ones via Homebrew (macOS) or apt/dnf/pacman (Linux).
2. Make sure `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN` are exported in your shell profile (the same values you already use to route Claude Code through the proxy).
3. Run the installer from wherever you cloned or copied this skill:
   ```bash
   bash ./install.sh
   ```
   It copies files into `~/.claude/`, primes the cache, and wires the statusline into `~/.claude/settings.json`.
4. Restart Claude Code (or start a new session) to see the statusline.

If you want to pin an endpoint/token independently of Claude Code's own env vars:
```bash
export CLAUDE_USAGE_ENDPOINT="https://your-claude-proxy.example.com/api/oauth/usage"
export CLAUDE_USAGE_TOKEN="your-api-token"
export CLAUDE_USAGE_BETA=""
bash ./install.sh
```
These persist to `~/.claude/.statusline-env` (mode 0600).

## Troubleshooting

- **Statusline blank or shows raw escape codes**: the Claude Code build doesn't honour ANSI cursor movement in statuslines. Edit `statusline.sh` → replace `align_right` with `printf "%s"` (accepts left alignment).
- **Plan-usage line missing**: run the poller manually: `bash ~/.claude/hooks/fetch-plan-usage.sh`. It prints the reason to stderr. Most common: `401` (token rejected by the proxy — check your `ANTHROPIC_AUTH_TOKEN`), or `no token available`.
- **Quota line missing entirely**: the user account has no effective daily quota (unlimited). The proxy returns `null` utilization which hides the row by design.
- **`resets 0m` always**: ISO timestamp was parsed as local time. The script sets `TZ=UTC`; if regressed, confirm `/bin/date` is the one being invoked (not a GNU `date` shadowing on macOS).
- **Box characters instead of icons**: terminal font doesn't cover `◐ ⌬ ⧗ ◷ ♛ ◆ ▸ ⎇`. Swap to ASCII in `statusline.sh` (e.g. `ctx:`, `model:`, `day:`, `rank:`).
- **Leaderboard row missing**: you haven't made any requests through the proxy today yet — rank is `null` until you do.

## Uninstall

```bash
rm ~/.claude/statusline-command.sh \
   ~/.claude/hooks/fetch-plan-usage.sh \
   ~/.claude/cache/plan-usage.json \
   ~/.claude/.statusline-env

# Then remove `statusLine` from ~/.claude/settings.json.
```
