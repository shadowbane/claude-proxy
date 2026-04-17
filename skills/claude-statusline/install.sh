#!/usr/bin/env bash
# Install the claude-statusline skill for the current user.
# The statusline self-refreshes plan usage every ~2 min while Claude Code is open.
#
# Env overrides (optional; persisted to ~/.claude/.statusline-env mode 0600):
#   CLAUDE_USAGE_ENDPOINT  Custom /api/oauth/usage URL (e.g. a MiMo-V2 proxy).
#   CLAUDE_USAGE_TOKEN     Static bearer token.
#   CLAUDE_USAGE_BETA      Override the anthropic-beta header (empty = omit).

set -euo pipefail

skill_dir=$(cd "$(dirname "$0")" && pwd)
claude_dir="$HOME/.claude"
hooks_dir="$claude_dir/hooks"
cache_dir="$claude_dir/cache"
mkdir -p "$hooks_dir" "$cache_dir"

statusline_dst="$claude_dir/statusline-command.sh"
poller_dst="$hooks_dir/fetch-plan-usage.sh"
env_file="$claude_dir/.statusline-env"

install -m 0755 "$skill_dir/statusline.sh" "$statusline_dst"
install -m 0755 "$skill_dir/fetch-plan-usage.sh" "$poller_dst"

if [ -n "${CLAUDE_USAGE_ENDPOINT:-}${CLAUDE_USAGE_TOKEN:-}${CLAUDE_USAGE_BETA+set}" ]; then
  {
    [ -n "${CLAUDE_USAGE_ENDPOINT:-}" ] && printf 'CLAUDE_USAGE_ENDPOINT=%q\n' "$CLAUDE_USAGE_ENDPOINT"
    [ -n "${CLAUDE_USAGE_TOKEN:-}" ]    && printf 'CLAUDE_USAGE_TOKEN=%q\n'    "$CLAUDE_USAGE_TOKEN"
    [ -n "${CLAUDE_USAGE_BETA+set}" ]   && printf 'CLAUDE_USAGE_BETA=%q\n'     "${CLAUDE_USAGE_BETA:-}"
  } > "$env_file"
  chmod 600 "$env_file"
  echo "wrote $env_file"
fi

# Prime the cache so the plan-usage line shows up on the first render.
if ! bash "$poller_dst"; then
  echo "WARNING: initial poller run failed — statusline will still work, but the plan-usage line will be missing until credentials/endpoint are fixed." >&2
fi

# Wire the statusline into Claude Code settings.json (idempotent).
settings="$claude_dir/settings.json"
if command -v jq >/dev/null 2>&1; then
  tmp=$(mktemp)
  if [ -f "$settings" ]; then
    jq --arg cmd "bash $statusline_dst" \
      '.statusLine = {type: "command", command: $cmd}' "$settings" > "$tmp"
  else
    jq -n --arg cmd "bash $statusline_dst" \
      '{statusLine: {type: "command", command: $cmd}}' > "$tmp"
  fi
  mv "$tmp" "$settings"
  echo "updated $settings"
else
  echo "jq not installed — add this to $settings manually:" >&2
  echo "  \"statusLine\": {\"type\": \"command\", \"command\": \"bash $statusline_dst\"}" >&2
fi

echo
echo "Done. Start a new Claude Code session to see the statusline."
