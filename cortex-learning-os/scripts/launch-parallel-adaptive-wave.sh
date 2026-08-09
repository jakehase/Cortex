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
REMOTE_EXECUTION_PRIVATE_KEY="/home/jake/.config/cortex-learning-os/authorities/execution.private.pem"
SOURCE_REF="refs/heads/main"
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
ASSESSMENT_BANK=""
APPROVED_MODEL_EXECUTABLE_BINDING=""

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
    --remote-execution-private-key) REMOTE_EXECUTION_PRIVATE_KEY="${2:-}"; shift 2 ;;
    --source-ref) SOURCE_REF="${2:-}"; shift 2 ;;
    --state-root) STATE_ROOT="${2:-}"; shift 2 ;;
    --expires-seconds) EXPIRES_SECONDS="${2:-}"; shift 2 ;;
    --graph) LOCAL_GRAPH="${2:-}"; shift 2 ;;
    --policy) LOCAL_POLICY="${2:-}"; shift 2 ;;
    --capsule) LOCAL_CAPSULE="${2:-}"; shift 2 ;;
    --remote-graph) REMOTE_GRAPH="${2:-}"; shift 2 ;;
    --remote-policy) REMOTE_POLICY="${2:-}"; shift 2 ;;
    --remote-capsule) REMOTE_CAPSULE="${2:-}"; shift 2 ;;
    --assessment-bank) ASSESSMENT_BANK="${2:-}"; shift 2 ;;
    --approved-model-executable-binding) APPROVED_MODEL_EXECUTABLE_BINDING="${2:-}"; shift 2 ;;
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
[[ "$REMOTE_EXECUTION_PRIVATE_KEY" =~ ^/[A-Za-z0-9._/-]+$ ]] || { echo "unsafe remote execution private key" >&2; exit 2; }
[[ "$SOURCE_REF" =~ ^refs/heads/[A-Za-z0-9._/-]+$ && "$SOURCE_REF" != *..* ]] || { echo "unsafe source ref" >&2; exit 2; }
[[ "$ASSESSMENT_BANK" =~ ^/[A-Za-z0-9._/-]+$ ]] || { echo "--assessment-bank requires a safe absolute owner-only path" >&2; exit 2; }
[[ -f "$ASSESSMENT_BANK" && ! -L "$ASSESSMENT_BANK" && -r "$ASSESSMENT_BANK" ]] || { echo "independent assessment bank is unavailable" >&2; exit 2; }
[[ "$APPROVED_MODEL_EXECUTABLE_BINDING" =~ ^/[A-Za-z0-9._/-]+$ ]] || { echo "--approved-model-executable-binding requires a safe absolute path" >&2; exit 2; }
[[ -f "$APPROVED_MODEL_EXECUTABLE_BINDING" && ! -L "$APPROVED_MODEL_EXECUTABLE_BINDING" && -r "$APPROVED_MODEL_EXECUTABLE_BINDING" ]] || { echo "approved model executable binding is unavailable" >&2; exit 2; }
BOUND_CODEX_BIN="$(node -e 'const b=require(process.argv[1]);process.stdout.write(String(b.path||""))' "$APPROVED_MODEL_EXECUTABLE_BINDING")"
[[ "$BOUND_CODEX_BIN" =~ ^/opt/cortex-learning-os/approved-model-executors/[0-9a-f]{64}/codex$ ]] || { echo "approved model executable binding path is invalid" >&2; exit 2; }
REMOTE_CODEX_BIN="$BOUND_CODEX_BIN"
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
ORIGIN_SOURCE="$(git -C "$LOCAL_REPO" ls-remote origin "$SOURCE_REF" | awk '{print $1}')"
[[ "$SOURCE_COMMIT" == "$ORIGIN_SOURCE" ]] || { echo "canonical source is not the exact pushed source ref" >&2; exit 3; }
REMOTE_COMMIT="$(ssh -o BatchMode=yes -o ConnectTimeout=10 "$SSH_HOST" cat "$REMOTE_REPO/CORTEX_LEARNING_OS_SOURCE_COMMIT" | tr -d '[:space:]')"
REMOTE_TREE="$(ssh -o BatchMode=yes -o ConnectTimeout=10 "$SSH_HOST" sudo -u jake -- git -C "$REMOTE_REPO" rev-parse "$REMOTE_COMMIT^{tree}" | tr -d '[:space:]')"
REMOTE_HEAD="$(ssh -o BatchMode=yes -o ConnectTimeout=10 "$SSH_HOST" sudo -u jake -- git -C "$REMOTE_REPO" rev-parse HEAD | tr -d '[:space:]')"
[[ "$REMOTE_COMMIT" == "$SOURCE_COMMIT" && "$REMOTE_HEAD" == "$SOURCE_COMMIT" && "$REMOTE_TREE" == "$SOURCE_TREE" ]] || { echo "Hetzner source commit/tree mismatch" >&2; exit 4; }
ssh -o BatchMode=yes -o ConnectTimeout=10 "$SSH_HOST" sudo -u jake -- "$REMOTE_CODEX_BIN" --version >/dev/null
ssh -o BatchMode=yes -o ConnectTimeout=10 "$SSH_HOST" test -f "$REMOTE_EXECUTION_PRIVATE_KEY" -a ! -L "$REMOTE_EXECUTION_PRIVATE_KEY"
[[ "$(ssh -o BatchMode=yes -o ConnectTimeout=10 "$SSH_HOST" stat -c '%U:%G:%a' "$REMOTE_EXECUTION_PRIVATE_KEY")" == "jake:jake:600" ]] || { echo "remote execution authority key is not owner-only" >&2; exit 4; }
ssh -o BatchMode=yes -o ConnectTimeout=10 "$SSH_HOST" test -x "$REMOTE_CLOS/scripts/remote-parallel-adaptive-child.sh"
ssh -o BatchMode=yes -o ConnectTimeout=10 "$SSH_HOST" test -f "$REMOTE_GRAPH" -a -f "$REMOTE_POLICY" -a -f "$REMOTE_CAPSULE"

install -d -m 700 "$WAVE_ROOT" "$LOCAL_ARTIFACT_ROOT" "$LOCAL_ARTIFACT_ROOT/children"
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
  --assessment-bank "$ASSESSMENT_BANK" \
  --approved-model-executable-binding "$APPROVED_MODEL_EXECUTABLE_BINDING" \
  --out "$WAVE_PLAN" >/dev/null

SELECTED_COUNT="$(node -e 'const w=require(process.argv[1]); process.stdout.write(String(w.selected.length))' "$WAVE_PLAN")"
MERGE_ORDER="$(node -e 'const w=require(process.argv[1]); process.stdout.write(w.mergeOrder.join(","))' "$WAVE_PLAN")"
mapfile -t RUN_IDS < <(node -e 'const w=require(process.argv[1]); for(const id of w.mergeOrder) console.log(id)' "$WAVE_PLAN")
[[ "${#RUN_IDS[@]}" -eq "$SELECTED_COUNT" ]] || { echo "wave merge order count differs from selected count" >&2; exit 5; }
[[ "$(IFS=,; echo "${RUN_IDS[*]}")" == "$MERGE_ORDER" ]] || { echo "wave merge order materialization changed" >&2; exit 5; }
DISPATCH_RECEIPTS_FILE="$WAVE_ROOT/dispatch-receipts.json"

emit_descriptor() {
python3 - "$WAVE_ID" "$WAVE_PLAN" "$LOCAL_STATE" "$LOCAL_ARTIFACT_ROOT" "$SOURCE_COMMIT" "$SOURCE_TREE" "$CONCURRENCY" "$SELECTED_COUNT" "$MERGE_ORDER" "$DRY_RUN" "$DISPATCH_RECEIPTS_FILE" <<'PY'
import json
from pathlib import Path
import sys
wave_id, wave, state, artifacts, commit, tree, concurrency, count, order, dry, receipts_path = sys.argv[1:]
receipts = json.loads(Path(receipts_path).read_text(encoding="utf-8")) if Path(receipts_path).is_file() else []
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
    "dispatchedCount": len(receipts),
    "dispatchReceipts": receipts,
    "frontierReached": int(count) == 0,
    "reviewSelectionEnabled": False,
    "placement": {
        "controlPlane": "wave planner, independent harvester, and notifier",
        "executionPlane": "concurrent detached Hetzner Codex children",
    },
}, indent=2))
PY
}

if [[ "$DRY_RUN" == true || "$SELECTED_COUNT" == "0" ]]; then
  printf '[]\n' >"$DISPATCH_RECEIPTS_FILE"
  emit_descriptor
  exit 0
fi

REMOTE_WAVE_ROOT="$REMOTE_REPO/state/cortex-learning-os/waves/$WAVE_ID"
REMOTE_PLAN_ROOT="$REMOTE_WAVE_ROOT/plans"
REMOTE_ASSESSMENT_BANK="$REMOTE_WAVE_ROOT/assessment-bank.json"
REMOTE_APPROVED_MODEL_EXECUTABLE_BINDING="$REMOTE_WAVE_ROOT/approved-model-executable.json"
ssh -o BatchMode=yes -o ConnectTimeout=10 "$SSH_HOST" \
  install -d -m 700 -o jake -g jake "$REMOTE_WAVE_ROOT" "$REMOTE_PLAN_ROOT"
ssh -o BatchMode=yes -o ConnectTimeout=10 "$SSH_HOST" \
  chown jake:jake "$REMOTE_WAVE_ROOT" "$REMOTE_PLAN_ROOT"
ssh -o BatchMode=yes -o ConnectTimeout=10 "$SSH_HOST" \
  chmod 700 "$REMOTE_WAVE_ROOT" "$REMOTE_PLAN_ROOT"
scp -q -o BatchMode=yes -o ConnectTimeout=10 "$ASSESSMENT_BANK" "$SSH_HOST:$REMOTE_ASSESSMENT_BANK"
scp -q -o BatchMode=yes -o ConnectTimeout=10 "$APPROVED_MODEL_EXECUTABLE_BINDING" "$SSH_HOST:$REMOTE_APPROVED_MODEL_EXECUTABLE_BINDING"
ssh -n -o BatchMode=yes -o ConnectTimeout=10 "$SSH_HOST" chown jake:jake "$REMOTE_ASSESSMENT_BANK"
ssh -n -o BatchMode=yes -o ConnectTimeout=10 "$SSH_HOST" chown jake:jake "$REMOTE_APPROVED_MODEL_EXECUTABLE_BINDING"
ssh -n -o BatchMode=yes -o ConnectTimeout=10 "$SSH_HOST" chmod 600 "$REMOTE_ASSESSMENT_BANK" "$REMOTE_APPROVED_MODEL_EXECUTABLE_BINDING"
for RUN_ID in "${RUN_IDS[@]}"; do
  LOCAL_CHILD_PLAN="$WAVE_ROOT/$RUN_ID.plan.json"
  REMOTE_CHILD_PLAN="$REMOTE_PLAN_ROOT/$RUN_ID.json"
  node -e 'const fs=require("fs"); const w=require(process.argv[1]); const id=process.argv[2]; const row=w.selected.find(x=>x.child.runId===id); if(!row)process.exit(2); fs.writeFileSync(process.argv[3], JSON.stringify(row.child.sessionPlan,null,2)+"\n",{mode:0o600});' \
    "$WAVE_PLAN" "$RUN_ID" "$LOCAL_CHILD_PLAN"
  scp -q -o BatchMode=yes -o ConnectTimeout=10 "$LOCAL_CHILD_PLAN" "$SSH_HOST:$REMOTE_CHILD_PLAN"
  ssh -n -o BatchMode=yes -o ConnectTimeout=10 "$SSH_HOST" chown jake:jake "$REMOTE_CHILD_PLAN"
  ssh -n -o BatchMode=yes -o ConnectTimeout=10 "$SSH_HOST" chmod 600 "$REMOTE_CHILD_PLAN"
done

SAFE_UNIT="clos-${WAVE_ID//[^a-zA-Z0-9-]/-}"
HARVEST_UNIT="$SAFE_UNIT-harvest"
NOTIFY_UNIT="$SAFE_UNIT-notify"
HARVEST_STARTED=false
NOTIFY_STARTED=false
cleanup_failed_launch() {
  local exit_code=$?
  if [[ "$exit_code" -ne 0 ]]; then
    [[ "$HARVEST_STARTED" == true ]] && systemctl stop "$HARVEST_UNIT.service" >/dev/null 2>&1 || true
    [[ "$NOTIFY_STARTED" == true ]] && systemctl stop "$NOTIFY_UNIT.service" >/dev/null 2>&1 || true
  fi
}
trap cleanup_failed_launch EXIT
systemd-run \
  --unit="$HARVEST_UNIT" --collect --quiet \
  --working-directory="$LOCAL_REPO" \
  /usr/bin/python3 "$LOCAL_CLOS/scripts/harvest-parallel-adaptive-wave.py" \
    --wave "$WAVE_PLAN" \
    --ssh-host "$SSH_HOST" \
    --remote-repo "$REMOTE_REPO" \
    --local-artifact-root "$LOCAL_ARTIFACT_ROOT" \
    --state-file "$LOCAL_STATE" \
    --state-root "$STATE_ROOT" \
    --live-control "$LOCAL_CLOS/src/live-control.mjs" \
    --graph "$LOCAL_GRAPH" \
    --policy "$LOCAL_POLICY" \
    --capsule "$LOCAL_CAPSULE" \
    --assessment-bank "$ASSESSMENT_BANK"
HARVEST_STARTED=true

if [[ "$NOTIFY" == true ]]; then
  NOTIFIER="$LOCAL_CLOS/scripts/detached_job_notifier.py"
  NOTIFY_COMMAND="until /usr/bin/python3 '$NOTIFIER' --once --state-file '$LOCAL_STATE' --job-label 'Cortex Learning OS parallel acquisition $WAVE_ID'; do sleep 30; done"
  systemd-run --unit="$NOTIFY_UNIT" --collect --quiet --working-directory="$LOCAL_REPO" /bin/bash -lc "$NOTIFY_COMMAND"
  NOTIFY_STARTED=true
fi

for RUN_ID in "${RUN_IDS[@]}"; do
  REMOTE_CHILD_PLAN="$REMOTE_PLAN_ROOT/$RUN_ID.json"
  REMOTE_UNIT="${SAFE_UNIT}-${RUN_ID##*.}"
  ssh -n -o BatchMode=yes -o ConnectTimeout=10 "$SSH_HOST" \
    systemd-run --unit="$REMOTE_UNIT" --collect --quiet \
      --property=User=jake --property=Group=jake \
      --working-directory="$REMOTE_CLOS" \
      /bin/bash "$REMOTE_CLOS/scripts/remote-parallel-adaptive-child.sh" \
        "$WAVE_ID" "$RUN_ID" "$SOURCE_COMMIT" "$SOURCE_TREE" "$REMOTE_CODEX_BIN" "$REMOTE_CHILD_PLAN" \
        "$REMOTE_GRAPH" "$REMOTE_POLICY" "$REMOTE_CAPSULE" \
        "$REMOTE_ASSESSMENT_BANK" "$REMOTE_APPROVED_MODEL_EXECUTABLE_BINDING" \
        "$REMOTE_EXECUTION_PRIVATE_KEY"
done

# Do not report or account for dispatch until every detached worker has written
# an identity-bound state receipt from the Hetzner execution plane.
ssh -o BatchMode=yes -o ConnectTimeout=10 "$SSH_HOST" \
  python3 - "$REMOTE_WAVE_ROOT" "$WAVE_ID" "$SOURCE_COMMIT" "$SOURCE_TREE" "${RUN_IDS[@]}" \
  >"$DISPATCH_RECEIPTS_FILE" <<'PY'
import json
from pathlib import Path
import sys
import time

root, wave_id, commit, tree, *run_ids = sys.argv[1:]
deadline = time.monotonic() + 30
while True:
    receipts = []
    missing = []
    for run_id in run_ids:
        path = Path(root) / f"{run_id}.json"
        try:
            receipt = json.loads(path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            missing.append(run_id)
            continue
        if not isinstance(receipt, dict):
            raise SystemExit(f"invalid dispatch receipt for {run_id}")
        if receipt.get("waveId") != wave_id or receipt.get("runId") != run_id:
            raise SystemExit(f"dispatch receipt identity mismatch for {run_id}")
        if receipt.get("sourceCommit") != commit or receipt.get("sourceTree") != tree:
            raise SystemExit(f"dispatch receipt source mismatch for {run_id}")
        if receipt.get("placement") != "hetzner":
            raise SystemExit(f"dispatch receipt placement mismatch for {run_id}")
        if receipt.get("status") == "failed":
            raise SystemExit(f"remote child failed during dispatch: {run_id}: {receipt.get('reason', '')}")
        if receipt.get("status") not in {"running", "candidate"}:
            raise SystemExit(f"invalid dispatch receipt status for {run_id}")
        receipts.append(receipt)
    if not missing:
        print(json.dumps(receipts, indent=2, sort_keys=True))
        break
    if time.monotonic() >= deadline:
        raise SystemExit(f"timed out waiting for remote dispatch receipts: {','.join(missing)}")
    time.sleep(0.5)
PY

[[ "$(node -e 'const r=require(process.argv[1]); process.stdout.write(String(r.length))' "$DISPATCH_RECEIPTS_FILE")" == "$SELECTED_COUNT" ]] \
  || { echo "remote dispatch receipt count differs from selected count" >&2; exit 6; }
emit_descriptor
trap - EXIT
