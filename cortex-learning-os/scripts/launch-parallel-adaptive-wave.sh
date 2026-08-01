#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
LOCAL_CLOS="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
LOCAL_REPO="$(cd -- "$LOCAL_CLOS/.." && pwd -P)"
CONCURRENCY=4
SSH_HOST="root@37.27.129.239"
REMOTE_REPO="/home/jake/clawd-remote"
REMOTE_CLOS="$REMOTE_REPO/cortex-learning-os"
REMOTE_CODEX_BIN="/home/jake/.local/bin/codex"
STATE_ROOT="/root/.openclaw/cortex-learning-os"
EXPIRES_SECONDS=14400
DRY_RUN=false
NOTIFY=true
LOCAL_GRAPH="$LOCAL_CLOS/capsules/math-foundations/curriculum.phd-trajectory-v1.graph.json"
LOCAL_POLICY="$LOCAL_CLOS/policies/adaptive-math-phd-v1.json"
LOCAL_CAPSULE="$LOCAL_CLOS/capsules/math-foundations/capsule.json"
REMOTE_GRAPH="$REMOTE_CLOS/capsules/math-foundations/curriculum.phd-trajectory-v1.graph.json"
REMOTE_POLICY="$REMOTE_CLOS/policies/adaptive-math-phd-v1.json"
REMOTE_CAPSULE="$REMOTE_CLOS/capsules/math-foundations/capsule.json"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --concurrency) CONCURRENCY="${2:-}"; shift 2 ;;
    --ssh-host) SSH_HOST="${2:-}"; shift 2 ;;
    --remote-repo)
      REMOTE_REPO="${2:-}"
      REMOTE_CLOS="$REMOTE_REPO/cortex-learning-os"
      REMOTE_GRAPH="$REMOTE_CLOS/capsules/math-foundations/curriculum.phd-trajectory-v1.graph.json"
      REMOTE_POLICY="$REMOTE_CLOS/policies/adaptive-math-phd-v1.json"
      REMOTE_CAPSULE="$REMOTE_CLOS/capsules/math-foundations/capsule.json"
      shift 2
      ;;
    --remote-codex-bin) REMOTE_CODEX_BIN="${2:-}"; shift 2 ;;
    --state-root) STATE_ROOT="${2:-}"; shift 2 ;;
    --expires-seconds) EXPIRES_SECONDS="${2:-}"; shift 2 ;;
    --graph) LOCAL_GRAPH="${2:-}"; shift 2 ;;
    --policy) LOCAL_POLICY="${2:-}"; shift 2 ;;
    --capsule) LOCAL_CAPSULE="${2:-}"; shift 2 ;;
    --remote-graph) REMOTE_GRAPH="${2:-}"; shift 2 ;;
    --remote-policy) REMOTE_POLICY="${2:-}"; shift 2 ;;
    --remote-capsule) REMOTE_CAPSULE="${2:-}"; shift 2 ;;
    --no-notify) NOTIFY=false; shift ;;
    --dry-run) DRY_RUN=true; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[[ "$CONCURRENCY" =~ ^[1-8]$ ]] || { echo "--concurrency must be 1..8" >&2; exit 2; }
[[ "$EXPIRES_SECONDS" =~ ^[0-9]+$ ]] && (( EXPIRES_SECONDS >= 300 && EXPIRES_SECONDS <= 86400 )) || { echo "--expires-seconds must be 300..86400" >&2; exit 2; }
[[ "$SSH_HOST" =~ ^[A-Za-z0-9._-]+@[A-Za-z0-9._:-]+$ ]] || { echo "unsafe SSH host" >&2; exit 2; }
[[ "$REMOTE_REPO" =~ ^/[A-Za-z0-9._/-]+$ ]] || { echo "unsafe remote repo" >&2; exit 2; }
[[ "$REMOTE_CODEX_BIN" =~ ^/[A-Za-z0-9._/-]+$ ]] || { echo "unsafe remote Codex executable" >&2; exit 2; }
for input_path in "$LOCAL_GRAPH" "$LOCAL_POLICY" "$LOCAL_CAPSULE" "$REMOTE_GRAPH" "$REMOTE_POLICY" "$REMOTE_CAPSULE"; do
  [[ "$input_path" =~ ^/[A-Za-z0-9._/-]+$ ]] || { echo "unsafe adaptive input path" >&2; exit 2; }
done
for input_path in "$LOCAL_GRAPH" "$LOCAL_POLICY" "$LOCAL_CAPSULE"; do
  [[ -f "$input_path" && ! -L "$input_path" ]] || { echo "local adaptive input is unavailable: $input_path" >&2; exit 2; }
done

WAVE_ID="math-wave-$(date -u +%Y%m%dT%H%M%SZ)-$(openssl rand -hex 3)"
WAVE_ROOT="$STATE_ROOT/waves/$WAVE_ID"
WAVE_PLAN="$WAVE_ROOT/wave.json"
LOCAL_ARTIFACT_ROOT="$LOCAL_REPO/artifacts/cortex-learning-os-waves/$WAVE_ID"
LOCAL_STATE="$WAVE_ROOT/state.json"
if [[ -f "$LOCAL_REPO/CORTEX_LEARNING_OS_SOURCE_COMMIT" ]]; then
  SOURCE_COMMIT="$(tr -d '[:space:]' < "$LOCAL_REPO/CORTEX_LEARNING_OS_SOURCE_COMMIT")"
else
  SOURCE_COMMIT="$(git -C "$LOCAL_REPO" rev-parse HEAD)"
fi
[[ "$SOURCE_COMMIT" =~ ^[0-9a-f]{40}$ ]] || { echo "invalid canonical source marker" >&2; exit 3; }
SOURCE_TREE="$(git -C "$LOCAL_REPO" rev-parse "$SOURCE_COMMIT^{tree}")"
CHECKED_OUT_COMMIT="$(git -C "$LOCAL_REPO" rev-parse HEAD)"
[[ "$CHECKED_OUT_COMMIT" == "$SOURCE_COMMIT" ]] || { echo "checked-out source differs from canonical marker" >&2; exit 3; }
ORIGIN_MAIN="$(git -C "$LOCAL_REPO" ls-remote origin refs/heads/main | awk '{print $1}')"
[[ "$SOURCE_COMMIT" == "$ORIGIN_MAIN" ]] || { echo "canonical source is not origin/main" >&2; exit 3; }
REMOTE_COMMIT="$(ssh -o BatchMode=yes -o ConnectTimeout=10 "$SSH_HOST" cat "$REMOTE_REPO/CORTEX_LEARNING_OS_SOURCE_COMMIT" | tr -d '[:space:]')"
REMOTE_TREE="$(ssh -o BatchMode=yes -o ConnectTimeout=10 "$SSH_HOST" git -C "$REMOTE_REPO" rev-parse "$REMOTE_COMMIT^{tree}" | tr -d '[:space:]')"
REMOTE_HEAD="$(ssh -o BatchMode=yes -o ConnectTimeout=10 "$SSH_HOST" git -C "$REMOTE_REPO" rev-parse HEAD | tr -d '[:space:]')"
[[ "$REMOTE_COMMIT" == "$SOURCE_COMMIT" && "$REMOTE_HEAD" == "$SOURCE_COMMIT" && "$REMOTE_TREE" == "$SOURCE_TREE" ]] || { echo "Hetzner source commit/tree mismatch" >&2; exit 4; }
ssh -o BatchMode=yes -o ConnectTimeout=10 "$SSH_HOST" sudo -u jake -- "$REMOTE_CODEX_BIN" --version >/dev/null
ssh -o BatchMode=yes -o ConnectTimeout=10 "$SSH_HOST" test -x "$REMOTE_CLOS/scripts/remote-parallel-adaptive-child.sh"
ssh -o BatchMode=yes -o ConnectTimeout=10 "$SSH_HOST" test -f "$REMOTE_GRAPH" -a -f "$REMOTE_POLICY" -a -f "$REMOTE_CAPSULE"

install -d -m 700 "$WAVE_ROOT" "$LOCAL_ARTIFACT_ROOT/children"
EXPIRES_AT="$(date -u -d "+$EXPIRES_SECONDS seconds" +%Y-%m-%dT%H:%M:%S.000Z)"
node "$LOCAL_CLOS/src/live-control.mjs" adaptive-wave-plan \
  --state-root "$STATE_ROOT" \
  --wave-id "$WAVE_ID" \
  --seed "$WAVE_ID" \
  --concurrency "$CONCURRENCY" \
  --expires-at "$EXPIRES_AT" \
  --source-commit "$SOURCE_COMMIT" \
  --source-tree "$SOURCE_TREE" \
  --graph "$LOCAL_GRAPH" \
  --policy "$LOCAL_POLICY" \
  --capsule "$LOCAL_CAPSULE" \
  --out "$WAVE_PLAN" >/dev/null

SELECTED_COUNT="$(node -e 'const w=require(process.argv[1]); process.stdout.write(String(w.selected.length))' "$WAVE_PLAN")"
MERGE_ORDER="$(node -e 'const w=require(process.argv[1]); process.stdout.write(w.mergeOrder.join(","))' "$WAVE_PLAN")"
python3 - "$WAVE_ID" "$WAVE_PLAN" "$LOCAL_STATE" "$LOCAL_ARTIFACT_ROOT" "$SOURCE_COMMIT" "$SOURCE_TREE" "$CONCURRENCY" "$SELECTED_COUNT" "$MERGE_ORDER" "$DRY_RUN" <<'PY'
import json
import sys
wave_id, wave, state, artifacts, commit, tree, concurrency, count, order, dry = sys.argv[1:]
print(json.dumps({
    "ok": True,
    "dryRun": dry == "true",
    "waveId": wave_id,
    "wave": wave,
    "stateFile": state,
    "artifactRoot": artifacts,
    "sourceCommit": commit,
    "sourceTree": tree,
    "concurrency": int(concurrency),
    "selectedCount": int(count),
    "mergeOrder": order.split(",") if order else [],
    "frontierReached": int(count) == 0,
    "reviewSelectionEnabled": False,
    "placement": {
        "controlPlane": "wave planner, independent harvester, and notifier",
        "executionPlane": "concurrent detached Hetzner Codex children",
    },
}, indent=2))
PY
[[ "$DRY_RUN" == true || "$SELECTED_COUNT" == "0" ]] && exit 0

REMOTE_PLAN_ROOT="$REMOTE_REPO/state/cortex-learning-os/waves/$WAVE_ID/plans"
ssh -o BatchMode=yes -o ConnectTimeout=10 "$SSH_HOST" install -d -m 700 -o jake -g jake "$REMOTE_PLAN_ROOT"
while IFS= read -r RUN_ID; do
  LOCAL_CHILD_PLAN="$WAVE_ROOT/$RUN_ID.plan.json"
  REMOTE_CHILD_PLAN="$REMOTE_PLAN_ROOT/$RUN_ID.json"
  node -e 'const fs=require("fs"); const w=require(process.argv[1]); const id=process.argv[2]; const row=w.selected.find(x=>x.child.runId===id); if(!row)process.exit(2); fs.writeFileSync(process.argv[3], JSON.stringify(row.child.sessionPlan,null,2)+"\n",{mode:0o600});' \
    "$WAVE_PLAN" "$RUN_ID" "$LOCAL_CHILD_PLAN"
  scp -q -o BatchMode=yes -o ConnectTimeout=10 "$LOCAL_CHILD_PLAN" "$SSH_HOST:$REMOTE_CHILD_PLAN"
  ssh -o BatchMode=yes -o ConnectTimeout=10 "$SSH_HOST" chown jake:jake "$REMOTE_CHILD_PLAN"
  ssh -o BatchMode=yes -o ConnectTimeout=10 "$SSH_HOST" chmod 600 "$REMOTE_CHILD_PLAN"
done < <(node -e 'const w=require(process.argv[1]); for(const id of w.mergeOrder) console.log(id)' "$WAVE_PLAN")

SAFE_UNIT="clos-${WAVE_ID//[^a-zA-Z0-9-]/-}"
systemd-run \
  --unit="$SAFE_UNIT-harvest" --collect --quiet \
  --working-directory="$LOCAL_REPO" \
  /usr/bin/python3 "$LOCAL_CLOS/scripts/harvest-parallel-adaptive-wave.py" \
    --wave "$WAVE_PLAN" \
    --ssh-host "$SSH_HOST" \
    --remote-repo "$REMOTE_REPO" \
    --local-artifact-root "$LOCAL_ARTIFACT_ROOT" \
    --state-file "$LOCAL_STATE" \
    --state-root "$STATE_ROOT" \
    --graph "$LOCAL_GRAPH" \
    --policy "$LOCAL_POLICY" \
    --capsule "$LOCAL_CAPSULE"

if [[ "$NOTIFY" == true ]]; then
  NOTIFIER="$LOCAL_CLOS/scripts/detached_job_notifier.py"
  NOTIFY_COMMAND="until /usr/bin/python3 '$NOTIFIER' --once --state-file '$LOCAL_STATE' --job-label 'Cortex Learning OS parallel acquisition $WAVE_ID'; do sleep 30; done"
  systemd-run --unit="$SAFE_UNIT-notify" --collect --quiet --working-directory="$LOCAL_REPO" /bin/bash -lc "$NOTIFY_COMMAND"
fi

while IFS= read -r RUN_ID; do
  REMOTE_CHILD_PLAN="$REMOTE_PLAN_ROOT/$RUN_ID.json"
  REMOTE_UNIT="${SAFE_UNIT}-${RUN_ID##*.}"
  ssh -o BatchMode=yes -o ConnectTimeout=10 "$SSH_HOST" \
    systemd-run --unit="$REMOTE_UNIT" --collect --quiet \
      --property=User=jake --property=Group=jake \
      --working-directory="$REMOTE_CLOS" \
      /bin/bash "$REMOTE_CLOS/scripts/remote-parallel-adaptive-child.sh" \
        "$WAVE_ID" "$RUN_ID" "$SOURCE_COMMIT" "$SOURCE_TREE" "$REMOTE_CODEX_BIN" "$REMOTE_CHILD_PLAN" \
        "$REMOTE_GRAPH" "$REMOTE_POLICY" "$REMOTE_CAPSULE"
done < <(node -e 'const w=require(process.argv[1]); for(const id of w.mergeOrder) console.log(id)' "$WAVE_PLAN")
