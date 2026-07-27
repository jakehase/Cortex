#!/usr/bin/env bash
set -Eeuo pipefail

MAX_SESSIONS=100
MAX_WALL_SECONDS=86400
CHILD_TIMEOUT_SECONDS=14400
POLL_SECONDS=15
NOTIFY=true
DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --max-sessions) MAX_SESSIONS="${2:-}"; shift 2 ;;
    --max-wall-seconds) MAX_WALL_SECONDS="${2:-}"; shift 2 ;;
    --child-timeout-seconds) CHILD_TIMEOUT_SECONDS="${2:-}"; shift 2 ;;
    --poll-seconds) POLL_SECONDS="${2:-}"; shift 2 ;;
    --no-notify) NOTIFY=false; shift ;;
    --dry-run) DRY_RUN=true; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[[ "$MAX_SESSIONS" =~ ^[0-9]+$ ]] && (( MAX_SESSIONS >= 1 && MAX_SESSIONS <= 100 )) || { echo "--max-sessions must be 1..100" >&2; exit 2; }
[[ "$MAX_WALL_SECONDS" =~ ^[0-9]+([.][0-9]+)?$ ]] && awk "BEGIN { exit !($MAX_WALL_SECONDS >= 300 && $MAX_WALL_SECONDS <= 86400) }" || { echo "--max-wall-seconds must be 300..86400" >&2; exit 2; }
[[ "$CHILD_TIMEOUT_SECONDS" =~ ^[0-9]+([.][0-9]+)?$ ]] && awk "BEGIN { exit !($CHILD_TIMEOUT_SECONDS >= 60 && $CHILD_TIMEOUT_SECONDS <= 14400) }" || { echo "--child-timeout-seconds must be 60..14400" >&2; exit 2; }
[[ "$POLL_SECONDS" =~ ^[0-9]+([.][0-9]+)?$ ]] || { echo "invalid --poll-seconds" >&2; exit 2; }

CONTINUATION_ID="math-continuation-$(date -u +%Y%m%dT%H%M%SZ)-$(openssl rand -hex 3)"
SAFE_UNIT="clos-${CONTINUATION_ID//[^a-zA-Z0-9-]/-}"
SUPERVISOR_UNIT="${SAFE_UNIT}-supervisor"
NOTIFY_UNIT="${SAFE_UNIT}-notify"
STATE_FILE="/root/clawd/state/cortex-learning-os/continuations/$CONTINUATION_ID.json"
ARTIFACT_ROOT="/root/clawd/artifacts/cortex-learning-os-continuations/$CONTINUATION_ID"
SUPERVISOR="/root/clawd/cortex-learning-os/scripts/continue_adaptive_math.py"
NOTIFIER="/root/clawd/scripts/detached_job_notifier.py"

[[ -x "$SUPERVISOR" ]] || { echo "continuation supervisor is missing" >&2; exit 3; }
[[ -x "$NOTIFIER" ]] || { echo "detached notifier is missing" >&2; exit 3; }
install -d -m 700 "$(dirname "$STATE_FILE")" "$ARTIFACT_ROOT"

SUPERVISOR_ARGS=(
  --continuation-id "$CONTINUATION_ID"
  --state-file "$STATE_FILE"
  --artifact-root "$ARTIFACT_ROOT"
  --max-sessions "$MAX_SESSIONS"
  --max-wall-seconds "$MAX_WALL_SECONDS"
  --child-timeout-seconds "$CHILD_TIMEOUT_SECONDS"
  --poll-seconds "$POLL_SECONDS"
)

python3 - "$CONTINUATION_ID" "$STATE_FILE" "$ARTIFACT_ROOT" "$SUPERVISOR_UNIT" "$NOTIFY_UNIT" "$MAX_SESSIONS" "$MAX_WALL_SECONDS" "$DRY_RUN" <<'PY'
import json, sys
continuation_id, state_file, artifact_root, supervisor, notifier, max_sessions, max_wall, dry_run = sys.argv[1:]
print(json.dumps({
    "ok": True,
    "dryRun": dry_run == "true",
    "continuationId": continuation_id,
    "stateFile": state_file,
    "artifactRoot": artifact_root,
    "maxSessions": int(max_sessions),
    "maxWallSeconds": float(max_wall),
    "thinking": "xhigh",
    "units": {"supervisor": supervisor, "notifier": notifier},
    "placement": {
        "controlPlane": "lightweight supervisor, independent harvester, and notifier",
        "executionPlane": "sequential detached Hetzner Codex workers",
    },
    "reviewSelectionEnabled": False,
    "stopCondition": "first genuine policy, evidence, infrastructure, source-drift, no-progress, wall-time, or session-cap blocker, or honest curriculum_frontier_reached completion",
}, indent=2))
PY

if [[ "$DRY_RUN" == true ]]; then
  exec /usr/bin/python3 "$SUPERVISOR" "${SUPERVISOR_ARGS[@]}" --dry-run
fi

systemd-run \
  --unit="$SUPERVISOR_UNIT" --collect --quiet \
  --property=Restart=on-failure --property=RestartSec=30 \
  --working-directory=/root/clawd \
  /usr/bin/python3 "$SUPERVISOR" "${SUPERVISOR_ARGS[@]}"

if [[ "$NOTIFY" == true ]]; then
  NOTIFY_COMMAND="until /usr/bin/python3 '$NOTIFIER' --once --state-file '$STATE_FILE' --job-label 'Cortex Learning OS adaptive math continuation $CONTINUATION_ID'; do sleep 30; done"
  systemd-run \
    --unit="$NOTIFY_UNIT" --collect --quiet \
    --working-directory=/root/clawd \
    /bin/bash -lc "$NOTIFY_COMMAND"
fi
