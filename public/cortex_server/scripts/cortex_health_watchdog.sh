#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="${CORTEX_WATCHDOG_SERVICE:-cortex.service}"
BASE_URL="${CORTEX_WATCHDOG_BASE_URL:-http://127.0.0.1:8000}"
STATE_FILE="${CORTEX_WATCHDOG_STATE_FILE:-/var/lib/cortex-health-watchdog/state}"
LOCK_FILE="${CORTEX_WATCHDOG_LOCK_FILE:-/run/cortex-health-watchdog/lock}"
MEMORY_FILE="${CORTEX_WATCHDOG_MEMORY_FILE:-/sys/fs/cgroup/system.slice/cortex.service/memory.stat}"
MEMORY_CURRENT_FILE="${CORTEX_WATCHDOG_MEMORY_CURRENT_FILE:-/sys/fs/cgroup/system.slice/cortex.service/memory.current}"
# Anonymous memory tracks the retained native heap. Total cgroup memory catches
# sustained file-cache pressure before MemoryHigh begins throttling write paths.
MEMORY_LIMIT_BYTES="${CORTEX_WATCHDOG_MEMORY_LIMIT_BYTES:-1610612736}"
MEMORY_CURRENT_LIMIT_BYTES="${CORTEX_WATCHDOG_MEMORY_CURRENT_LIMIT_BYTES:-2080374784}"
DATABASE_FILE="${CORTEX_WATCHDOG_DATABASE_FILE:-/app/cortex_server/chroma_db/l22_structured.sqlite3}"
DATABASE_LIMIT_BYTES="${CORTEX_WATCHDOG_DATABASE_LIMIT_BYTES:-805306368}"
DATABASE_GROWTH_LIMIT_BYTES="${CORTEX_WATCHDOG_DATABASE_GROWTH_LIMIT_BYTES:-67108864}"
CODEC_RECORD_LIMIT_BYTES="${CORTEX_WATCHDOG_CODEC_RECORD_LIMIT_BYTES:-524288}"
FAILURES_BEFORE_RESTART="${CORTEX_WATCHDOG_FAILURES_BEFORE_RESTART:-3}"
RESTART_COOLDOWN_SECONDS="${CORTEX_WATCHDOG_RESTART_COOLDOWN_SECONDS:-600}"
CURL_BIN="${CORTEX_WATCHDOG_CURL_BIN:-curl}"
SYSTEMCTL_BIN="${CORTEX_WATCHDOG_SYSTEMCTL_BIN:-systemctl}"
PYTHON_BIN="${CORTEX_WATCHDOG_PYTHON_BIN:-python3}"
NOW="${CORTEX_WATCHDOG_NOW:-$(date +%s)}"

mkdir -p "$(dirname "$STATE_FILE")" "$(dirname "$LOCK_FILE")"
exec 9>"$LOCK_FILE"
flock -n 9 || exit 0

read_state_number() {
  local key="$1" default="$2" value
  value="$(sed -n "s/^${key}=\([0-9][0-9]*\)$/\1/p" "$STATE_FILE" 2>/dev/null | tail -n 1 || true)"
  printf '%s' "${value:-$default}"
}

write_state() {
  local failures="$1" last_restart="$2" reason="$3" database_bytes="${4:-0}" codec_max_record_bytes="${5:-0}"
  local tmp="${STATE_FILE}.tmp.$$"
  printf 'failures=%s\nlast_restart=%s\nlast_reason=%s\nupdated_at=%s\ndatabase_bytes=%s\ndatabase_checked_at=%s\ncodec_max_record_bytes=%s\n' \
    "$failures" "$last_restart" "$reason" "$NOW" "$database_bytes" "$NOW" "$codec_max_record_bytes" >"$tmp"
  chmod 0600 "$tmp"
  mv -f "$tmp" "$STATE_FILE"
}

json_flag_true() {
  local path="$1" field="$2"
  "$PYTHON_BIN" - "$path" "$field" <<'PY'
import json, sys
path, field = sys.argv[1:3]
try:
    value = json.load(open(path, encoding="utf-8"))
except Exception:
    raise SystemExit(1)
for part in field.split("."):
    if not isinstance(value, dict) or part not in value:
        raise SystemExit(1)
    value = value[part]
raise SystemExit(0 if value is True else 1)
PY
}

probe_json() {
  local route="$1" field="$2" tmp
  tmp="$(mktemp)"
  if "$CURL_BIN" -fsS --connect-timeout 2 --max-time 4 "${BASE_URL}${route}" >"$tmp" \
      && json_flag_true "$tmp" "$field"; then
    rm -f "$tmp"
    return 0
  fi
  rm -f "$tmp"
  return 1
}

reason="healthy"
if ! probe_json "/health" "success"; then
  reason="health_probe_failed"
elif ! probe_json "/ready" "ready"; then
  reason="readiness_probe_failed"
elif ! probe_json "/l22/status" "success"; then
  reason="l22_status_probe_failed"
fi

memory_bytes=0
if [[ -r "$MEMORY_FILE" ]]; then
  if grep -q '^anon ' "$MEMORY_FILE" 2>/dev/null; then
    memory_bytes="$(awk '$1 == "anon" { print $2; exit }' "$MEMORY_FILE")"
  else
    memory_bytes="$(tr -dc '0-9' <"$MEMORY_FILE")"
  fi
  memory_bytes="${memory_bytes:-0}"
  if (( memory_bytes >= MEMORY_LIMIT_BYTES )); then
    reason="anonymous_memory_threshold_exceeded"
  fi
fi
memory_current_bytes=0
if [[ -r "$MEMORY_CURRENT_FILE" ]]; then
  memory_current_bytes="$(tr -dc '0-9' <"$MEMORY_CURRENT_FILE")"
  memory_current_bytes="${memory_current_bytes:-0}"
  if (( memory_current_bytes >= MEMORY_CURRENT_LIMIT_BYTES )); then
    reason="cgroup_memory_threshold_exceeded"
  fi
fi

database_bytes=0
codec_max_record_bytes=0
previous_database_bytes="$(read_state_number database_bytes 0)"
previous_database_checked_at="$(read_state_number database_checked_at 0)"
if [[ -r "$DATABASE_FILE" ]]; then
  for database_part in "$DATABASE_FILE" "$DATABASE_FILE-wal" "$DATABASE_FILE-shm"; do
    if [[ -f "$database_part" ]]; then
      part_bytes="$(stat -c '%s' "$database_part" 2>/dev/null || printf '0')"
      database_bytes=$((database_bytes + ${part_bytes:-0}))
    fi
  done
  codec_max_record_bytes="$($PYTHON_BIN - "$DATABASE_FILE" <<'PY'
import sqlite3, sys
try:
    connection = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True, timeout=2)
    try:
        row = connection.execute(
            "SELECT COALESCE(MAX(length(CAST(content AS BLOB))), 0) "
            "FROM structured_memory WHERE memory_type = 'codec_state'"
        ).fetchone()
        print(int(row[0] or 0))
    finally:
        connection.close()
except Exception:
    print(0)
PY
)"
  codec_max_record_bytes="${codec_max_record_bytes:-0}"
fi

# Persistent-store damage is fail-closed. Restarting cannot shrink an amplified
# database, so these reasons override ordinary availability and memory probes.
if (( codec_max_record_bytes > CODEC_RECORD_LIMIT_BYTES )); then
  reason="codec_record_size_threshold_exceeded"
elif (( database_bytes >= DATABASE_LIMIT_BYTES )); then
  reason="database_size_threshold_exceeded"
elif (( previous_database_bytes > 0 && previous_database_checked_at > 0 && NOW > previous_database_checked_at \
    && database_bytes - previous_database_bytes >= DATABASE_GROWTH_LIMIT_BYTES )); then
  reason="database_growth_threshold_exceeded"
fi

last_restart="$(read_state_number last_restart 0)"
if [[ "$reason" == "healthy" ]]; then
  write_state 0 "$last_restart" "$reason" "$database_bytes" "$codec_max_record_bytes"
  exit 0
fi

failures="$(read_state_number failures 0)"
failures=$((failures + 1))
write_state "$failures" "$last_restart" "$reason" "$database_bytes" "$codec_max_record_bytes"
printf 'cortex-health-watchdog: failure %s/%s reason=%s anon_bytes=%s current_bytes=%s database_bytes=%s codec_max_record_bytes=%s\n' \
  "$failures" "$FAILURES_BEFORE_RESTART" "$reason" "$memory_bytes" "$memory_current_bytes" "$database_bytes" "$codec_max_record_bytes" >&2

if [[ "$reason" == "codec_record_size_threshold_exceeded" \
   || "$reason" == "database_size_threshold_exceeded" \
   || "$reason" == "database_growth_threshold_exceeded" ]]; then
  "$SYSTEMCTL_BIN" stop "$SERVICE_NAME"
  write_state "$failures" "$last_restart" "fail_closed:${reason}" "$database_bytes" "$codec_max_record_bytes"
  printf 'cortex-health-watchdog: stopped %s to prevent persistent-store amplification reason=%s\n' "$SERVICE_NAME" "$reason" >&2
  exit 1
fi

if (( failures < FAILURES_BEFORE_RESTART )); then
  exit 0
fi
if (( NOW - last_restart < RESTART_COOLDOWN_SECONDS )); then
  printf 'cortex-health-watchdog: restart suppressed by cooldown (%ss)\n' "$RESTART_COOLDOWN_SECONDS" >&2
  exit 0
fi

# Stop then start, rather than using systemctl restart, so systemd removes the
# old cgroup and releases its attributed file cache. TimeoutStopSec bounds a
# process stuck in reclaim and escalates it to SIGKILL.
"$SYSTEMCTL_BIN" stop "$SERVICE_NAME"
"$SYSTEMCTL_BIN" start "$SERVICE_NAME"
write_state 0 "$NOW" "restart_completed:${reason}" "$database_bytes" "$codec_max_record_bytes"
printf 'cortex-health-watchdog: completed cold restart for %s reason=%s\n' "$SERVICE_NAME" "$reason" >&2
