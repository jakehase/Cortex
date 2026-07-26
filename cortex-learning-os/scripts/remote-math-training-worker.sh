#!/usr/bin/env bash
set -Eeuo pipefail

RUN_ID="${1:-}"
EXAM_NAME="${2:-stress}"
EXPECTED_COMMIT="${3:-}"
ROOT="/home/jake/clawd-remote/cortex-learning-os"
REPO_ROOT="/home/jake/clawd-remote"
STATE_DIR="/home/jake/clawd-remote/state/cortex-learning-os"
LOG_DIR="/home/jake/clawd-remote/logs/cortex-learning-os"
ARTIFACT_ROOT="$ROOT/artifacts/$RUN_ID"
STATE_FILE="$STATE_DIR/$RUN_ID.json"
LOG_FILE="$LOG_DIR/$RUN_ID.log"
LOCK_FILE="$STATE_DIR/math-training.lock"

[[ "$RUN_ID" =~ ^math-training-[0-9]{8}T[0-9]{6}Z-[a-z0-9]{6}$ ]] || { echo "invalid run id" >&2; exit 2; }
[[ "$EXPECTED_COMMIT" =~ ^[0-9a-f]{40}$ ]] || { echo "invalid expected commit" >&2; exit 2; }
case "$EXAM_NAME" in
  baseline) NPM_SCRIPT="train:math" ;;
  challenge) NPM_SCRIPT="train:math:challenge" ;;
  stress) NPM_SCRIPT="train:math:stress" ;;
  *) echo "exam must be baseline, challenge, or stress" >&2; exit 2 ;;
esac
mkdir -p "$STATE_DIR" "$LOG_DIR" "$ARTIFACT_ROOT"
chmod 700 "$STATE_DIR" "$LOG_DIR"

write_state() {
  local status="$1"
  local reason="${2:-}"
  local temporary="$STATE_FILE.tmp.$$"
  STATUS="$status" REASON="$reason" RUN_ID="$RUN_ID" EXAM_NAME="$EXAM_NAME" ARTIFACT_ROOT="$ARTIFACT_ROOT" EXPECTED_COMMIT="$EXPECTED_COMMIT" \
    python3 - "$temporary" <<'PY'
import json, os, sys, datetime
payload = {
  "schemaVersion": "cortex.learning_os.remote_math_training_state.v1",
  "status": os.environ["STATUS"],
  "runId": os.environ["RUN_ID"],
  "exam": os.environ["EXAM_NAME"],
  "artifactRoot": os.environ["ARTIFACT_ROOT"],
  "sourceCommit": os.environ["EXPECTED_COMMIT"],
  "updatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z"),
}
if os.environ.get("REASON"):
  payload["reason"] = os.environ["REASON"][:2000]
with open(sys.argv[1], "w", encoding="utf-8") as handle:
  json.dump(payload, handle, indent=2, sort_keys=True)
  handle.write("\n")
PY
  chmod 600 "$temporary"
  mv -f "$temporary" "$STATE_FILE"
}

on_error() {
  local exit_code=$?
  write_state failed "remote math training worker failed with exit code $exit_code; inspect $LOG_FILE"
  exit "$exit_code"
}
trap on_error ERR

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  write_state failed "another Cortex Learning OS math training run holds the single-writer lock"
  exit 9
fi

write_state running "remote validation and Codex training are running"
{
  echo "run_id=$RUN_ID"
  echo "exam=$EXAM_NAME"
  echo "expected_commit=$EXPECTED_COMMIT"
  echo "started_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  ACTUAL_COMMIT="$(git -C "$REPO_ROOT" rev-parse HEAD)"
  echo "actual_commit=$ACTUAL_COMMIT"
  [[ "$ACTUAL_COMMIT" == "$EXPECTED_COMMIT" ]]
  cd "$ROOT"
  npm test
  set +e
  npm run "$NPM_SCRIPT" -- --run-id "$RUN_ID" --artifact-root "$ARTIFACT_ROOT"
  TRAIN_EXIT=$?
  set -e
  echo "training_exit=$TRAIN_EXIT"
  [[ -f "$ARTIFACT_ROOT/run_summary.json" ]]
  OUTCOME="$(node -e 'const s=require(process.argv[1]); process.stdout.write(String(s.status||"unknown")+"\n"+String(Boolean(s.learningLoopCompleted)))' "$ARTIFACT_ROOT/run_summary.json")"
  SUMMARY_STATUS="${OUTCOME%%$'\n'*}"
  LEARNING_COMPLETED="${OUTCOME##*$'\n'}"
  echo "summary_status=$SUMMARY_STATUS"
  echo "learning_loop_completed=$LEARNING_COMPLETED"
  if [[ "$TRAIN_EXIT" -eq 0 && "$SUMMARY_STATUS" == "green" && "$LEARNING_COMPLETED" == "true" ]]; then
    write_state candidate_green "all training and promotion gates passed; awaiting control-plane verification and live registry installation"
  elif [[ "$SUMMARY_STATUS" == blocked_* ]]; then
    write_state completed "training ended without a promoted lesson: $SUMMARY_STATUS"
  else
    write_state failed "training did not produce a gate-qualified lesson: status=$SUMMARY_STATUS exit=$TRAIN_EXIT"
  fi
  echo "finished_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
} >>"$LOG_FILE" 2>&1
trap - ERR
