#!/usr/bin/env bash
# Poll the plan-usage endpoint and cache the response for the statusline.
# Cross-platform (macOS + Linux).
#
# Configuration (env vars, optionally sourced from ~/.claude/.statusline-env):
#   CLAUDE_USAGE_ENDPOINT  URL to GET. If unset, falls back to:
#                            1. ${ANTHROPIC_BASE_URL}/api/oauth/usage (if ANTHROPIC_BASE_URL is set)
#                            2. https://api.anthropic.com/api/oauth/usage
#   CLAUDE_USAGE_TOKEN     Bearer token. If unset, falls back to:
#                            1. ANTHROPIC_AUTH_TOKEN
#                            2. ~/.claude/.credentials.json  (.claudeAiOauth.accessToken)
#                            3. macOS Keychain               (security find-generic-password -s "Claude Code-credentials" -w)
#   CLAUDE_USAGE_BETA      Value of the `anthropic-beta` header. Default: oauth-2025-04-20.
#                          Set to empty to omit the header (useful for custom proxies).

set -u

env_file="$HOME/.claude/.statusline-env"
# shellcheck disable=SC1090
[ -f "$env_file" ] && . "$env_file"

if [ -n "${CLAUDE_USAGE_ENDPOINT:-}" ]; then
  endpoint="$CLAUDE_USAGE_ENDPOINT"
elif [ -n "${ANTHROPIC_BASE_URL:-}" ]; then
  endpoint="${ANTHROPIC_BASE_URL%/}/api/oauth/usage"
else
  endpoint="https://api.anthropic.com/api/oauth/usage"
fi
beta="${CLAUDE_USAGE_BETA-oauth-2025-04-20}"

cache_dir="$HOME/.claude/cache"
cache_file="$cache_dir/plan-usage.json"
mkdir -p "$cache_dir"

token="${CLAUDE_USAGE_TOKEN:-${ANTHROPIC_AUTH_TOKEN:-}}"

# Fallback 1: Claude Code's credentials file (common on Linux).
if [ -z "$token" ] && [ -f "$HOME/.claude/.credentials.json" ]; then
  token=$(jq -r '.claudeAiOauth.accessToken // empty' "$HOME/.claude/.credentials.json" 2>/dev/null)
fi

# Fallback 2: macOS Keychain.
if [ -z "$token" ] && command -v security >/dev/null 2>&1; then
  token=$(security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null \
    | jq -r '.claudeAiOauth.accessToken // empty' 2>/dev/null)
fi

if [ -z "$token" ]; then
  echo "fetch-plan-usage: no token available (set CLAUDE_USAGE_TOKEN or authenticate Claude Code)" >&2
  exit 1
fi

tmp=$(mktemp "$cache_dir/plan-usage.json.XXXXXX")
trap 'rm -f "$tmp" "$tmp.out"' EXIT

curl_args=(
  -sS
  -o "$tmp"
  -w "%{http_code}"
  "$endpoint"
  -H "Authorization: Bearer $token"
  -H "User-Agent: claude-code/statusline-poller"
  -H "Accept: application/json"
)
[ -n "$beta" ] && curl_args+=(-H "anthropic-beta: $beta")

http=$(curl "${curl_args[@]}")

if [ "$http" != "200" ]; then
  echo "fetch-plan-usage: HTTP $http from $endpoint" >&2
  exit 1
fi

if ! jq -e . "$tmp" >/dev/null 2>&1; then
  echo "fetch-plan-usage: response is not valid JSON" >&2
  exit 1
fi

jq --arg ts "$(date -u +%s)" '. + {fetched_at: ($ts | tonumber)}' "$tmp" > "$tmp.out" \
  && mv "$tmp.out" "$cache_file"
