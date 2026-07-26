#!/usr/bin/env bash
set -Eeuo pipefail

EXAM="stress"
SSH_HOST="root@37.27.129.239"
REMOTE_REPO="/home/jake/clawd-remote"
REMOTE_CLOS="$REMOTE_REPO/cortex-learning-os"
LOCAL_CLOS="/root/clawd/cortex-learning-os"
STATE_ROOT="/root/.openclaw/cortex-learning-os"
DRY_RUN=false
NOTIFY=true

while [[ $# -gt 0 ]]; do
  case "$1" in
    --exam) EXAM="${2:-}"; shift 2 ;;
    --ssh-host) SSH_HOST="${2:-}"; shift 2 ;;
    --remote-repo) REMOTE_REPO="${2:-}"; REMOTE_CLOS="$REMOTE_REPO/cortex-learning-os"; shift 2 ;;
    --state-root) STATE_ROOT="${2:-}"; shift 2 ;;
    --no-notify) NOTIFY=false; shift ;;
    --dry-run) DRY_RUN=true; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
case "$EXAM" in baseline|challenge|stress) ;; *) echo "--exam must be baseline, challenge, or stress" >&2; exit 2 ;; esac
[[ "$SSH_HOST" =~ ^[A-Za-z0-9._-]+@[A-Za-z0-9._:-]+$ ]] || { echo "unsafe SSH host" >&2; exit 2; }
[[ "$REMOTE_REPO" =~ ^/[A-Za-z0-9._/-]+$ ]] || { echo "unsafe remote repo path" >&2; exit 2; }
[[ "$STATE_ROOT" =~ ^/[A-Za-z0-9._/-]+$ ]] || { echo "unsafe state root" >&2; exit 2; }

RUN_ID="math-training-$(date -u +%Y%m%dT%H%M%SZ)-$(openssl rand -hex 3)"
SAFE_UNIT="clos-${RUN_ID//[^a-zA-Z0-9-]/-}"
REMOTE_UNIT="${SAFE_UNIT}-worker"
HARVEST_UNIT="${SAFE_UNIT}-harvest"
NOTIFY_UNIT="${SAFE_UNIT}-notify"
REMOTE_STATE="$REMOTE_REPO/state/cortex-learning-os/$RUN_ID.json"

LOCAL_COMMIT="$(tr -d '[:space:]' < /root/clawd/CORTEX_LEARNING_OS_SOURCE_COMMIT)"
[[ "$LOCAL_COMMIT" =~ ^[0-9a-f]{40}$ ]] || { echo "canonical source marker is invalid" >&2; exit 3; }
REMOTE_MAIN="$(git -C /root/clawd ls-remote origin refs/heads/main | awk '{print $1}')"
[[ "$LOCAL_COMMIT" == "$REMOTE_MAIN" ]] || { echo "canonical source marker is not origin/main" >&2; exit 3; }
node "$LOCAL_CLOS/src/live-control.mjs" verify --state-root "$STATE_ROOT" >/dev/null

REMOTE_COMMIT="$(ssh -o BatchMode=yes -o ConnectTimeout=10 "$SSH_HOST" cat "$REMOTE_REPO/CORTEX_LEARNING_OS_SOURCE_COMMIT" | tr -d '[:space:]')"
[[ "$REMOTE_COMMIT" == "$LOCAL_COMMIT" ]] || { echo "remote source commit $REMOTE_COMMIT does not match canonical $LOCAL_COMMIT" >&2; exit 4; }
ssh -o BatchMode=yes -o ConnectTimeout=10 "$SSH_HOST" test -x "$REMOTE_CLOS/scripts/remote-math-training-worker.sh"
test -x "$LOCAL_CLOS/scripts/harvest-live-math-training.py"

python3 - "$RUN_ID" "$EXAM" "$LOCAL_COMMIT" "$REMOTE_COMMIT" "$REMOTE_STATE" "$REMOTE_UNIT" "$HARVEST_UNIT" "$NOTIFY_UNIT" "$DRY_RUN" <<'PY'
import json, sys
run_id, exam, local_commit, remote_commit, state, worker, harvest, notify, dry_run = sys.argv[1:]
print(json.dumps({
  "ok": True,
  "dryRun": dry_run == "true",
  "runId": run_id,
  "exam": exam,
  "sourceCommit": local_commit,
  "remoteCommit": remote_commit,
  "remoteState": state,
  "units": {"worker": worker, "harvester": harvest, "notifier": notify},
  "placement": {"controlPlane": "harvester and notifier only", "executionPlane": "Hetzner Codex worker"},
  "promotion": "automatic only after full remote gates, copied-manifest verification, approved profile mapping, and signed-registry install"
}, indent=2))
PY
[[ "$DRY_RUN" == true ]] && exit 0

systemd-run \
  --unit="$HARVEST_UNIT" --collect --quiet \
  --working-directory=/root/clawd \
  /usr/bin/python3 "$LOCAL_CLOS/scripts/harvest-live-math-training.py" \
    --run-id "$RUN_ID" --ssh-host "$SSH_HOST" --state-root "$STATE_ROOT"

if [[ "$NOTIFY" == true ]]; then
  NOTIFY_COMMAND="until /usr/bin/python3 /root/clawd/scripts/detached_job_notifier.py --once --state-file '$REMOTE_STATE' --ssh-host '$SSH_HOST' --job-label 'Cortex Learning OS math training $RUN_ID'; do sleep 30; done"
  systemd-run \
    --unit="$NOTIFY_UNIT" --collect --quiet \
    --working-directory=/root/clawd \
    /bin/bash -lc "$NOTIFY_COMMAND"
fi

ssh -o BatchMode=yes -o ConnectTimeout=10 "$SSH_HOST" \
  systemd-run --unit="$REMOTE_UNIT" --collect --quiet \
    --property=User=jake --property=Group=jake \
    --working-directory="$REMOTE_CLOS" \
    /bin/bash "$REMOTE_CLOS/scripts/remote-math-training-worker.sh" "$RUN_ID" "$EXAM" "$LOCAL_COMMIT"
