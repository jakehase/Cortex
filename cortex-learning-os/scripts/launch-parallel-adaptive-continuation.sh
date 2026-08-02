#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
LOCAL_CLOS="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
LOCAL_REPO="$(cd -- "$LOCAL_CLOS/.." && pwd -P)"
CONCURRENCY=4
MAX_WAVES=100
MAX_SESSIONS=800
MAX_WALL_SECONDS=86400
WAVE_TIMEOUT_SECONDS=14400
POLL_SECONDS=15
NOTIFY=true
DRY_RUN=false
REMOTE_CLOS="/home/jake/clawd-remote/cortex-learning-os"
GRAPH="$LOCAL_CLOS/capsules/math-foundations/curriculum.phd-trajectory-v1.graph.json"
POLICY="$LOCAL_CLOS/policies/adaptive-math-phd-v1.json"
CAPSULE="$LOCAL_CLOS/capsules/math-foundations/capsule.json"
REMOTE_GRAPH="$REMOTE_CLOS/capsules/math-foundations/curriculum.phd-trajectory-v1.graph.json"
REMOTE_POLICY="$REMOTE_CLOS/policies/adaptive-math-phd-v1.json"
REMOTE_CAPSULE="$REMOTE_CLOS/capsules/math-foundations/capsule.json"
ASSESSMENT_BANK=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --concurrency) CONCURRENCY="${2:-}"; shift 2 ;;
    --max-waves) MAX_WAVES="${2:-}"; shift 2 ;;
    --max-sessions) MAX_SESSIONS="${2:-}"; shift 2 ;;
    --max-wall-seconds) MAX_WALL_SECONDS="${2:-}"; shift 2 ;;
    --wave-timeout-seconds) WAVE_TIMEOUT_SECONDS="${2:-}"; shift 2 ;;
    --poll-seconds) POLL_SECONDS="${2:-}"; shift 2 ;;
    --graph) GRAPH="${2:-}"; shift 2 ;;
    --policy) POLICY="${2:-}"; shift 2 ;;
    --capsule) CAPSULE="${2:-}"; shift 2 ;;
    --remote-graph) REMOTE_GRAPH="${2:-}"; shift 2 ;;
    --remote-policy) REMOTE_POLICY="${2:-}"; shift 2 ;;
    --remote-capsule) REMOTE_CAPSULE="${2:-}"; shift 2 ;;
    --assessment-bank) ASSESSMENT_BANK="${2:-}"; shift 2 ;;
    --no-notify) NOTIFY=false; shift ;;
    --dry-run) DRY_RUN=true; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[[ "$CONCURRENCY" =~ ^[1-8]$ ]] || { echo "--concurrency must be 1..8" >&2; exit 2; }
[[ "$MAX_WAVES" =~ ^[0-9]+$ ]] && (( MAX_WAVES >= 1 && MAX_WAVES <= 100 )) || { echo "--max-waves must be 1..100" >&2; exit 2; }
[[ "$MAX_SESSIONS" =~ ^[0-9]+$ ]] && (( MAX_SESSIONS >= 1 && MAX_SESSIONS <= 800 )) || { echo "--max-sessions must be 1..800" >&2; exit 2; }
[[ "$ASSESSMENT_BANK" =~ ^/[A-Za-z0-9._/-]+$ ]] || { echo "--assessment-bank requires a safe absolute owner-only path" >&2; exit 2; }
[[ -f "$ASSESSMENT_BANK" && ! -L "$ASSESSMENT_BANK" && -r "$ASSESSMENT_BANK" ]] || { echo "independent assessment bank is unavailable" >&2; exit 2; }

CONTINUATION_ID="math-acceleration-$(date -u +%Y%m%dT%H%M%SZ)-$(openssl rand -hex 3)"
SAFE_UNIT="clos-${CONTINUATION_ID//[^a-zA-Z0-9-]/-}"
STATE_FILE="$LOCAL_REPO/state/cortex-learning-os/parallel-continuations/$CONTINUATION_ID.json"
SUPERVISOR="$LOCAL_CLOS/scripts/continue_parallel_adaptive_math.py"
NOTIFIER="$LOCAL_CLOS/scripts/detached_job_notifier.py"
install -d -m 700 "$(dirname "$STATE_FILE")"

ARGS=(
  --continuation-id "$CONTINUATION_ID"
  --state-file "$STATE_FILE"
  --concurrency "$CONCURRENCY"
  --max-waves "$MAX_WAVES"
  --max-sessions "$MAX_SESSIONS"
  --max-wall-seconds "$MAX_WALL_SECONDS"
  --wave-timeout-seconds "$WAVE_TIMEOUT_SECONDS"
  --poll-seconds "$POLL_SECONDS"
  --launcher "$LOCAL_CLOS/scripts/launch-parallel-adaptive-wave.sh"
  --source-marker "$LOCAL_REPO/CORTEX_LEARNING_OS_SOURCE_COMMIT"
  --repo-root "$LOCAL_REPO"
  --graph "$GRAPH"
  --policy "$POLICY"
  --capsule "$CAPSULE"
  --assessment-bank "$ASSESSMENT_BANK"
  --remote-graph "$REMOTE_GRAPH"
  --remote-policy "$REMOTE_POLICY"
  --remote-capsule "$REMOTE_CAPSULE"
  --resume
)
python3 - "$CONTINUATION_ID" "$STATE_FILE" "$CONCURRENCY" "$MAX_WAVES" "$MAX_SESSIONS" "$DRY_RUN" <<'PY'
import json
import sys
identifier, state, concurrency, waves, sessions, dry = sys.argv[1:]
print(json.dumps({
    "ok": True,
    "dryRun": dry == "true",
    "continuationId": identifier,
    "stateFile": state,
    "concurrency": int(concurrency),
    "maxWaves": int(waves),
    "maxSessions": int(sessions),
    "reviewSelectionEnabled": False,
    "units": {"supervisor": f"clos-{identifier}-supervisor", "notifier": f"clos-{identifier}-notify"},
    "placement": {
        "controlPlane": "responsive supervisor, independent wave harvester, and notifier",
        "executionPlane": "concurrent detached Hetzner Codex children",
    },
}, indent=2))
PY

if [[ "$DRY_RUN" == true ]]; then
  exec /usr/bin/python3 "$SUPERVISOR" "${ARGS[@]}" --dry-run
fi
systemd-run \
  --unit="$SAFE_UNIT-supervisor" --collect --quiet \
  --property=Restart=on-failure --property=RestartSec=30 \
  --working-directory="$LOCAL_REPO" \
  /usr/bin/python3 "$SUPERVISOR" "${ARGS[@]}"
if [[ "$NOTIFY" == true ]]; then
  NOTIFY_COMMAND="until /usr/bin/python3 '$NOTIFIER' --once --state-file '$STATE_FILE' --job-label 'Cortex Learning OS parallel continuation $CONTINUATION_ID'; do sleep 30; done"
  systemd-run --unit="$SAFE_UNIT-notify" --collect --quiet --working-directory="$LOCAL_REPO" /bin/bash -lc "$NOTIFY_COMMAND"
fi
