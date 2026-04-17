#!/usr/bin/env bash
# Claude Code status line — right-aligned, multi-line.
# Tailored for claude-proxy: maps "five_hour" to the daily quota window
# and renders the proxy's leaderboard easter egg on the right side.

input=$(cat)

model=$(echo "$input" | jq -r '.model.display_name // "?"')
transcript=$(echo "$input" | jq -r '.transcript_path // empty')
used_pct=$(echo "$input" | jq -r '.context_window.used_percentage // empty')
cwd=$(echo "$input" | jq -r '.workspace.current_dir // .cwd // empty')

dir_name=""
[ -n "$cwd" ] && dir_name=$(basename "$cwd")

branch=""
if [ -n "$cwd" ] && git -C "$cwd" rev-parse --git-dir >/dev/null 2>&1; then
  branch=$(git -C "$cwd" --no-optional-locks symbolic-ref --short HEAD 2>/dev/null \
        || git -C "$cwd" --no-optional-locks rev-parse --short HEAD 2>/dev/null)
fi

header_parts=()
[ -n "$dir_name" ] && header_parts+=("▸ $dir_name")
[ -n "$branch" ] && header_parts+=("⎇ $branch")
line0="${header_parts[*]}"

sent=0; received=0; cache=0
if [ -n "$transcript" ] && [ -f "$transcript" ]; then
  read -r sent received cache < <(
    jq -r '
      select(.message.usage) | .message.usage |
      [
        (.input_tokens // 0),
        (.output_tokens // 0),
        ((.cache_creation_input_tokens // 0) + (.cache_read_input_tokens // 0))
      ] | @tsv
    ' "$transcript" 2>/dev/null | awk '
      { s+=$1; r+=$2; c+=$3 }
      END { printf "%d %d %d\n", s, r, c }
    '
  )
fi

io_total=$(( sent + received ))
grand_total=$(( sent + received + cache ))

fmt() { printf "%d" "$1" | sed -e :a -e 's/\(.*[0-9]\)\([0-9]\{3\}\)/\1,\2/;ta'; }

human() {
  awk -v n="$1" 'BEGIN {
    if (n >= 1000000) {
      v = n / 1000000
      printf (v == int(v)) ? "%dM" : "%.1fM", v
    } else if (n >= 1000) {
      v = n / 1000
      printf (v == int(v)) ? "%dk" : "%.1fk", v
    } else {
      printf "%d", n
    }
  }'
}

case "$model" in
  *1M*|*"1m"*) total_ctx=1000000 ;;
  *) total_ctx=200000 ;;
esac

# Each line split into left + right; lefts padded so rights align vertically.
left1="↑$(fmt $sent)  ↓$(fmt $received)  Σ$(fmt $io_total)"
right1=""
if [ -n "$used_pct" ]; then
  pct=$(printf "%.0f" "$used_pct")
  right1="◐ ${pct}% / $(human "$total_ctx")"
fi

left2="◆ $(fmt $cache)  Σ$(fmt $grand_total)"
right2="⌬ $model"

# Plan usage (5-hour, weekly) — cached by ~/.claude/hooks/fetch-plan-usage.sh
plan_cache="$HOME/.claude/cache/plan-usage.json"

# Self-refresh: if the cache is missing or older than stale_after seconds,
# fire-and-forget a background fetch. mkdir-based lock prevents multiple
# concurrent statusline renders (or multiple Claude Code sessions) from
# stampeding the endpoint.
poller="$HOME/.claude/hooks/fetch-plan-usage.sh"
stale_after=120   # 2 minutes
if [ -x "$poller" ]; then
  last=0
  [ -f "$plan_cache" ] && last=$(jq -r '.fetched_at // 0' "$plan_cache" 2>/dev/null || echo 0)
  if (( $(date +%s) - last > stale_after )); then
    lock_dir="$HOME/.claude/cache/plan-usage.lock"
    if mkdir "$lock_dir" 2>/dev/null; then
      ( trap 'rmdir "$lock_dir" 2>/dev/null' EXIT
        bash "$poller" >/dev/null 2>&1
      ) &
      disown 2>/dev/null || true
    fi
  fi
fi

left3=""; right3=""
if [ -f "$plan_cache" ]; then
  read -r fh_pct fh_reset lb_rank lb_total < <(
    jq -r '[
      (.five_hour.utilization   // ""),
      (.five_hour.resets_at     // ""),
      (.leaderboard.rank        // ""),
      (.leaderboard.total_users // "")
    ] | @tsv' "$plan_cache" 2>/dev/null
  )
  reset_in() {
    local iso=$1
    [ -z "$iso" ] && return
    local target now diff
    # macOS (BSD date) first, fall back to GNU date on Linux.
    target=$(TZ=UTC date -j -f "%Y-%m-%dT%H:%M:%S" "${iso%%.*}" "+%s" 2>/dev/null \
         || date -u -d "${iso%%.*}Z" "+%s" 2>/dev/null) || return
    now=$(date -u +%s)
    diff=$(( target - now ))
    (( diff < 0 )) && diff=0
    if (( diff >= 86400 )); then
      printf "resets %dd" $(( diff / 86400 ))
    elif (( diff >= 3600 )); then
      printf "resets %dh" $(( diff / 3600 ))
    else
      printf "resets %dm" $(( diff / 60 ))
    fi
  }
  if [ -n "$fh_pct" ]; then
    p=$(printf "%.0f" "$fh_pct")
    r=$(reset_in "$fh_reset")
    left3="⧗ day ${p}%${r:+ · $r}"
  fi
  # Easter egg: leaderboard rank on the right side.
  if [ -n "$lb_rank" ] && [ -n "$lb_total" ]; then
    right3="♛ rank #${lb_rank} / ${lb_total}"
  fi
fi

# Pad each left side to the max width so right sides start at the same column.
max_left=${#left1}
(( ${#left2} > max_left )) && max_left=${#left2}
(( ${#left3} > max_left )) && max_left=${#left3}

pad_left() {
  local s=$1 pad=$(( max_left - ${#1} ))
  (( pad < 0 )) && pad=0
  printf "%s%*s" "$s" "$pad" ""
}

sep="    "
line1="$(pad_left "$left1")${right1:+$sep$right1}"
line2="$(pad_left "$left2")${right2:+$sep$right2}"
line3=""
if [ -n "$left3" ] || [ -n "$right3" ]; then
  line3="$(pad_left "$left3")${right3:+$sep$right3}"
fi

# Right-align via ANSI: move cursor to far right, then back by content length.
align_right() {
  local s=$1
  local len=${#s}
  printf '\033[999C\033[%dD%s' "$len" "$s"
}

align_right "$line0"
printf "\n"
align_right "$line1"
printf "\n"
align_right "$line2"
if [ -n "$line3" ]; then
  printf "\n"
  align_right "$line3"
fi
