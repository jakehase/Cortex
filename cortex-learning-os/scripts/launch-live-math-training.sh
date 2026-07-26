#!/usr/bin/env bash
set -Eeuo pipefail

MODE="adaptive"
EXAM=""
SSH_HOST="root@37.27.129.239"
REMOTE_REPO="/home/jake/clawd-remote"
REMOTE_CLOS="$REMOTE_REPO/cortex-learning-os"
REMOTE_CODEX_BIN="/home/jake/.local/bin/codex"
LOCAL_CLOS="/root/clawd/cortex-learning-os"
STATE_ROOT="/root/.openclaw/cortex-learning-os"
DRY_RUN=false
NOTIFY=true

while [[ $# -gt 0 ]]; do
  case "$1" in
    --adaptive) MODE="adaptive"; EXAM=""; shift ;;
    --exam) MODE="legacy"; EXAM="${2:-}"; shift 2 ;;
    --ssh-host) SSH_HOST="${2:-}"; shift 2 ;;
    --remote-repo) REMOTE_REPO="${2:-}"; REMOTE_CLOS="$REMOTE_REPO/cortex-learning-os"; shift 2 ;;
    --remote-codex-bin) REMOTE_CODEX_BIN="${2:-}"; shift 2 ;;
    --state-root) STATE_ROOT="${2:-}"; shift 2 ;;
    --no-notify) NOTIFY=false; shift ;;
    --dry-run) DRY_RUN=true; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
if [[ "$MODE" == "legacy" ]]; then
  case "$EXAM" in baseline|challenge|stress) ;; *) echo "--exam must be baseline, challenge, or stress" >&2; exit 2 ;; esac
fi
[[ "$SSH_HOST" =~ ^[A-Za-z0-9._-]+@[A-Za-z0-9._:-]+$ ]] || { echo "unsafe SSH host" >&2; exit 2; }
[[ "$REMOTE_REPO" =~ ^/[A-Za-z0-9._/-]+$ ]] || { echo "unsafe remote repo path" >&2; exit 2; }
[[ "$REMOTE_CODEX_BIN" =~ ^/[A-Za-z0-9._/-]+$ ]] || { echo "unsafe remote Codex executable path" >&2; exit 2; }
[[ "$STATE_ROOT" =~ ^/[A-Za-z0-9._/-]+$ ]] || { echo "unsafe state root" >&2; exit 2; }

RUN_ID="math-training-$(date -u +%Y%m%dT%H%M%SZ)-$(openssl rand -hex 3)"
SAFE_UNIT="clos-${RUN_ID//[^a-zA-Z0-9-]/-}"
REMOTE_UNIT="${SAFE_UNIT}-worker"
HARVEST_UNIT="${SAFE_UNIT}-harvest"
NOTIFY_UNIT="${SAFE_UNIT}-notify"
REMOTE_STATE="$REMOTE_REPO/state/cortex-learning-os/$RUN_ID.json"
LOCAL_PLAN="$STATE_ROOT/training/plans/$RUN_ID.json"
REMOTE_PLAN="$REMOTE_REPO/state/cortex-learning-os/$RUN_ID.plan.json"

LOCAL_COMMIT="$(tr -d '[:space:]' < /root/clawd/CORTEX_LEARNING_OS_SOURCE_COMMIT)"
[[ "$LOCAL_COMMIT" =~ ^[0-9a-f]{40}$ ]] || { echo "canonical source marker is invalid" >&2; exit 3; }
REMOTE_MAIN="$(git -C /root/clawd ls-remote origin refs/heads/main | awk '{print $1}')"
[[ "$LOCAL_COMMIT" == "$REMOTE_MAIN" ]] || { echo "canonical source marker is not origin/main" >&2; exit 3; }
node "$LOCAL_CLOS/src/live-control.mjs" verify --state-root "$STATE_ROOT" >/dev/null
if [[ "$MODE" == "adaptive" ]]; then
  mkdir -p "$(dirname "$LOCAL_PLAN")"
  chmod 700 "$(dirname "$LOCAL_PLAN")"
  node "$LOCAL_CLOS/src/live-control.mjs" adaptive-plan \
    --state-root "$STATE_ROOT" --run-id "$RUN_ID" --seed "$RUN_ID" \
    --source-commit "$LOCAL_COMMIT" --out "$LOCAL_PLAN" >/dev/null
fi

REMOTE_COMMIT="$(ssh -o BatchMode=yes -o ConnectTimeout=10 "$SSH_HOST" cat "$REMOTE_REPO/CORTEX_LEARNING_OS_SOURCE_COMMIT" | tr -d '[:space:]')"
[[ "$REMOTE_COMMIT" == "$LOCAL_COMMIT" ]] || { echo "remote source commit $REMOTE_COMMIT does not match canonical $LOCAL_COMMIT" >&2; exit 4; }
ssh -o BatchMode=yes -o ConnectTimeout=10 "$SSH_HOST" test -x "$REMOTE_CLOS/scripts/remote-math-training-worker.sh"
REMOTE_CODEX_VERSION="$(ssh -o BatchMode=yes -o ConnectTimeout=10 "$SSH_HOST" sudo -u jake -- "$REMOTE_CODEX_BIN" --version | tr -d '\r' | head -n 1)"
[[ "$REMOTE_CODEX_VERSION" == codex-cli\ * ]] || { echo "remote Codex preflight failed for $REMOTE_CODEX_BIN as user jake" >&2; exit 4; }
test -x "$LOCAL_CLOS/scripts/harvest-live-math-training.py"

python3 - "$RUN_ID" "$MODE" "$EXAM" "$LOCAL_COMMIT" "$REMOTE_COMMIT" "$REMOTE_STATE" "$REMOTE_UNIT" "$HARVEST_UNIT" "$NOTIFY_UNIT" "$DRY_RUN" "$REMOTE_CODEX_BIN" "$REMOTE_CODEX_VERSION" "$LOCAL_PLAN" "$REMOTE_PLAN" <<'PY'
import json, sys
run_id, mode, exam, local_commit, remote_commit, state, worker, harvest, notify, dry_run, codex_bin, codex_version, local_plan, remote_plan = sys.argv[1:]
print(json.dumps({
  "ok": True,
  "dryRun": dry_run == "true",
  "runId": run_id,
  "mode": mode,
  "exam": exam or None,
  "adaptivePlan": {"local": local_plan, "remote": remote_plan} if mode == "adaptive" else None,
  "sourceCommit": local_commit,
  "remoteCommit": remote_commit,
  "remoteState": state,
  "workerRuntime": {"command": codex_bin, "version": codex_version, "serviceUser": "jake"},
  "units": {"worker": worker, "harvester": harvest, "notifier": notify},
  "placement": {"controlPlane": "harvester and notifier only", "executionPlane": "Hetzner Codex worker"},
  "promotion": "automatic only after generated-item replay, grading/provenance/policy replay, paired threshold separation, approved profile mapping, canonical mastery signing, and signed-registry install"
}, indent=2))
PY
[[ "$DRY_RUN" == true ]] && exit 0

if [[ "$MODE" == "adaptive" ]]; then
  ssh -o BatchMode=yes -o ConnectTimeout=10 "$SSH_HOST" mkdir -p "$(dirname "$REMOTE_PLAN")"
  ssh -o BatchMode=yes -o ConnectTimeout=10 "$SSH_HOST" chmod 700 "$(dirname "$REMOTE_PLAN")"
  scp -q -o BatchMode=yes -o ConnectTimeout=10 "$LOCAL_PLAN" "$SSH_HOST:$REMOTE_PLAN"
  ssh -o BatchMode=yes -o ConnectTimeout=10 "$SSH_HOST" chmod 600 "$REMOTE_PLAN"
fi

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
    /bin/bash "$REMOTE_CLOS/scripts/remote-math-training-worker.sh" "$RUN_ID" "$MODE" "$EXAM" "$LOCAL_COMMIT" "$REMOTE_CODEX_BIN" "$REMOTE_PLAN"
