#!/usr/bin/env bash
set -Eeuo pipefail

export HOME="${HOME:-/root}"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/0}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=/run/user/0/bus}"

ARTIFACT_ROOT="${MEMORY_AUDIT_ARTIFACT_ROOT:-/root/clawd/artifacts/memory-audit/incident-20260722}"
STATE_FILE="$ARTIFACT_ROOT/bridge-live-regression-state.json"
LOG_FILE="$ARTIFACT_ROOT/bridge-live-regression.log"
RESULT_FILE="$ARTIFACT_ROOT/bridge-live-regression-result.json"
RUN_ID="bridge-live-20260722T1905Z"
SESSION_ID="memory-audit-${RUN_ID}"
SECRET_SESSION_ID="memory-audit-secret-${RUN_ID}"
OLD_MARKER="OLD-CONTAMINATION-SENTINEL-${RUN_ID}"
CANARY="BRIDGE-DURABLE-CANARY-${RUN_ID}"
SECRET_MARKER="sk_test_AUDITBLOCK9Z7X6W"
CORTEX_URL="http://127.0.0.1:8000"
OPENCLAW_LOG="/tmp/openclaw/openclaw-2026-07-22.log"

mkdir -p "$ARTIFACT_ROOT"
exec >>"$LOG_FILE" 2>&1

write_state() {
  local status="$1" reason="${2:-}"
  python3 - "$STATE_FILE" "$status" "$reason" "$RESULT_FILE" <<'PY'
import json, os, sys, tempfile
from datetime import datetime, timezone
path, status, reason, result = sys.argv[1:5]
payload = {
    "schema": "cortex.memory-bridge-live-regression.state.v1",
    "status": status,
    "updatedAt": datetime.now(timezone.utc).isoformat(),
    "artifactPath": result,
}
if reason:
    payload["reason"] = reason
os.makedirs(os.path.dirname(path), exist_ok=True)
fd, temp = tempfile.mkstemp(prefix=".bridge-state-", dir=os.path.dirname(path))
with os.fdopen(fd, "w", encoding="utf-8") as handle:
    json.dump(payload, handle, indent=2, sort_keys=True); handle.write("\n"); handle.flush(); os.fsync(handle.fileno())
os.replace(temp, path)
PY
}

wait_cortex() {
  local ready=0
  for _ in $(seq 1 60); do
    if curl -fsS --max-time 3 "$CORTEX_URL/ready" | python3 -c 'import json,sys; assert json.load(sys.stdin).get("ready") is True' 2>/dev/null; then
      ready=1; break
    fi
    sleep 1
  done
  [[ "$ready" == 1 ]]
}

wait_gateway() {
  local ready=0
  for _ in $(seq 1 60); do
    if openclaw gateway status 2>&1 | grep -q 'Runtime: running'; then ready=1; break; fi
    sleep 1
  done
  [[ "$ready" == 1 ]]
}

counts() {
  curl -fsS --max-time 15 "$CORTEX_URL/l22/status" | python3 -c 'import json,sys; d=json.load(sys.stdin); print("{} {}".format(d.get("memory_count"), d.get("structured_memory_count")))'
}

on_error() {
  local line="$1" code="$2"
  set +e
  systemctl start cortex.service >/dev/null 2>&1
  systemctl start cortex-health-watchdog.timer >/dev/null 2>&1
  write_state failed "line ${line}, exit ${code}"
  exit "$code"
}
trap 'on_error "$LINENO" "$?"' ERR

write_state running
printf 'starting bridge live regression at %s\n' "$(date --iso-8601=seconds)"
# Give the initiating chat turn time to return before restarting its gateway host.
sleep 20

read -r semantic_before structured_before <<<"$(counts)"
printf 'counts before semantic=%s structured=%s\n' "$semantic_before" "$structured_before"

openclaw gateway restart
wait_gateway
printf 'gateway restarted and responsive\n'

# Seed an older low-durability assistant reply in the same transcript. The next
# write must select only the new latest assistant reply.
openclaw agent --agent oracle --session-id "$SESSION_ID" --thinking off --timeout 180 --json \
  --message "Reply with exactly this single line and nothing else: ${OLD_MARKER} ephemeral baseline." \
  >"$ARTIFACT_ROOT/bridge-old-turn.json"

openclaw agent --agent oracle --session-id "$SESSION_ID" --thinking off --timeout 180 --json \
  --message "Reply with exactly this single line and nothing else: Important decision: Cortex memory bridge production canary ${CANARY} is verified and enabled." \
  >"$ARTIFACT_ROOT/bridge-durable-turn.json"
sleep 3

read -r semantic_after_durable structured_after_durable <<<"$(counts)"
[[ "$semantic_after_durable" -ge $((semantic_before + 1)) ]]
[[ "$structured_after_durable" -ge $((structured_before + 1)) ]]

cat >"$ARTIFACT_ROOT/bridge-search-request.json" <<JSON
{"query":"${CANARY}","n_results":10}
JSON
curl -fsS --max-time 30 -H 'content-type: application/json' --data-binary @"$ARTIFACT_ROOT/bridge-search-request.json" \
  "$CORTEX_URL/knowledge/search" >"$ARTIFACT_ROOT/bridge-search-before-restart.json"
python3 - "$ARTIFACT_ROOT/bridge-search-before-restart.json" "$CANARY" "$OLD_MARKER" <<'PY'
import json, sys
path, canary, old = sys.argv[1:4]
payload = json.load(open(path, encoding="utf-8"))
raw = json.dumps(payload, ensure_ascii=False)
assert canary in raw, "durable bridge canary absent from semantic recall"
# The search response may include local audit notes mentioning the old-marker
# concept, so inspect the exact semantic result carrying the canary.
def walk(value):
    if isinstance(value, dict):
        yield value
        for child in value.values(): yield from walk(child)
    elif isinstance(value, list):
        for child in value: yield from walk(child)
rows = [row for row in walk(payload) if canary in json.dumps(row, ensure_ascii=False)]
assert rows, "no semantic result row carries canary"
assert any(old not in json.dumps(row, ensure_ascii=False) for row in rows), "new write contaminated by older assistant reply"
PY

python3 - "$SESSION_ID" "$CANARY" <<'PY'
import json, sqlite3, sys, time
session_id, canary = sys.argv[1:3]
lookup = f"agent:oracle:explicit:{session_id.lower()}"
p = "/app/cortex_server/chroma_db/l22_structured.sqlite3"
deadline = time.monotonic() + 20
rows = []
while time.monotonic() < deadline:
    con = sqlite3.connect(f"file:{p}?mode=ro", uri=True)
    rows = con.execute("select content from structured_memory where lookup_key=? order by created_at desc limit 4", (lookup,)).fetchall()
    con.close()
    if any(canary in row[0] for row in rows):
        break
    time.sleep(0.1)
assert rows, f"no Codec rows for {lookup}"
assert any(canary in row[0] for row in rows), "Codec row lacks latest canary after 20s"
for row in rows:
    state = json.loads(row[0])
    assert not ({"rollup_state", "promotion_state", "schema_state", "memory_facts", "durable_write"} & set(state))
    assert len(row[0].encode("utf-8")) <= 524288
PY

# A concrete synthetic secret-like assistant reply must reach neither semantic
# write-through nor Codec continuity.
openclaw_log_start=$(stat -c '%s' "$OPENCLAW_LOG")
openclaw agent --agent oracle --session-id "$SECRET_SESSION_ID" --thinking off --timeout 180 --json \
  --message "Reply with exactly this single line and nothing else: Important decision: Cortex memory bridge is verified and enabled; API key is ${SECRET_MARKER}." \
  >"$ARTIFACT_ROOT/bridge-secret-turn.json"
secret_block_seen=0
for _ in $(seq 1 60); do
  tail -c "+$((openclaw_log_start + 1))" "$OPENCLAW_LOG" >"$ARTIFACT_ROOT/bridge-secret-log-lines.txt"
  if grep -F 'reasons=decision,project_fact,secret_like' "$ARTIFACT_ROOT/bridge-secret-log-lines.txt" >/dev/null; then
    secret_block_seen=1
    break
  fi
  sleep 0.25
done
[[ "$secret_block_seen" == 1 ]]
read -r semantic_after_secret structured_after_secret <<<"$(counts)"
cat >"$ARTIFACT_ROOT/bridge-secret-search-request.json" <<JSON
{"query":"${SECRET_MARKER}","n_results":10}
JSON
curl -fsS --max-time 30 -H 'content-type: application/json' --data-binary @"$ARTIFACT_ROOT/bridge-secret-search-request.json" \
  "$CORTEX_URL/knowledge/search" >"$ARTIFACT_ROOT/bridge-secret-search.json"
python3 - "$ARTIFACT_ROOT/bridge-secret-search.json" "$SECRET_MARKER" <<'PY'
import json, sys
payload = json.load(open(sys.argv[1], encoding="utf-8"))
assert all(sys.argv[2] not in str(row.get("text") or "") for row in payload.get("results", [])), "secret-like value reached semantic memory"
PY
python3 - "$SECRET_SESSION_ID" <<'PY'
import sqlite3, sys
lookup = f"agent:oracle:explicit:{sys.argv[1].lower()}"
p = "/app/cortex_server/chroma_db/l22_structured.sqlite3"
con = sqlite3.connect(f"file:{p}?mode=ro", uri=True)
count = con.execute("select count(*) from structured_memory where lookup_key=?", (lookup,)).fetchone()[0]
con.close()
assert count == 0, f"secret-like Codec row persisted: {count}"
PY

# Prove both semantic and Codec state survive a cold Cortex cgroup replacement.
pid_before=$(systemctl show cortex.service -p MainPID --value)
systemctl stop cortex-health-watchdog.timer
systemctl stop cortex.service
[[ ! -d /sys/fs/cgroup/system.slice/cortex.service ]]
systemctl start cortex.service
wait_cortex
pid_after=$(systemctl show cortex.service -p MainPID --value)
[[ "$pid_before" != "$pid_after" ]]

curl -fsS --max-time 30 -H 'content-type: application/json' --data-binary @"$ARTIFACT_ROOT/bridge-search-request.json" \
  "$CORTEX_URL/knowledge/search" >"$ARTIFACT_ROOT/bridge-search-after-restart.json"
grep -F "$CANARY" "$ARTIFACT_ROOT/bridge-search-after-restart.json" >/dev/null
normalized_session_id="${SESSION_ID,,}"
curl -fsS --max-time 20 "$CORTEX_URL/nexus/codec/status?session_key=agent:oracle:explicit:${normalized_session_id}&max_chars=1200" \
  >"$ARTIFACT_ROOT/bridge-codec-after-restart.json"
python3 - "$ARTIFACT_ROOT/bridge-codec-after-restart.json" "$CANARY" <<'PY'
import json, sys
payload = json.load(open(sys.argv[1], encoding="utf-8"))
codec = payload.get("codec") or {}
assert payload.get("success") is True
assert sys.argv[2] in (codec.get("packet") or "")
assert (codec.get("durable") or {}).get("loaded_from_l22") is True
PY
systemctl start cortex-health-watchdog.timer

python3 - "$RESULT_FILE" <<PY
import json, os, sys, tempfile
from datetime import datetime, timezone
path = sys.argv[1]
payload = {
  "schema": "cortex.memory-bridge-live-regression.result.v1",
  "status": "completed",
  "completedAt": datetime.now(timezone.utc).isoformat(),
  "runId": "${RUN_ID}",
  "sessionKey": "agent:oracle:explicit:${SESSION_ID,,}",
  "gates": {
    "gateway_reload": True,
    "latest_assistant_capture": True,
    "semantic_recall_before_restart": True,
    "codec_capture_bounded": True,
    "older_reply_not_contaminated": True,
    "synthetic_secret_blocked_semantic": True,
    "synthetic_secret_blocked_codec": True,
    "cold_cgroup_replacement": True,
    "semantic_recall_after_restart": True,
    "codec_hydration_after_restart": True,
    "watchdog_reenabled": True,
  },
  "counts": {
    "semanticBefore": int("${semantic_before}"),
    "semanticAfterDurable": int("${semantic_after_durable}"),
    "semanticAfterSecret": int("${semantic_after_secret}"),
    "structuredBefore": int("${structured_before}"),
    "structuredAfterDurable": int("${structured_after_durable}"),
    "structuredAfterSecret": int("${structured_after_secret}"),
  },
  "pids": {"beforeColdRestart": int("${pid_before}"), "afterColdRestart": int("${pid_after}")},
  "artifactRoot": "${ARTIFACT_ROOT}",
}
os.makedirs(os.path.dirname(path), exist_ok=True)
fd, temp = tempfile.mkstemp(prefix=".bridge-result-", dir=os.path.dirname(path))
with os.fdopen(fd, "w", encoding="utf-8") as handle:
    json.dump(payload, handle, indent=2, sort_keys=True); handle.write("\n"); handle.flush(); os.fsync(handle.fileno())
os.replace(temp, path)
PY
write_state completed
trap - ERR
printf 'bridge live regression completed\n'
