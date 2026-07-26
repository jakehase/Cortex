#!/usr/bin/env bash
set -Eeuo pipefail

RUN_ID="${1:-}"
MODE_ARG="${2:-adaptive}"
case "$MODE_ARG" in
  adaptive)
    MODE="adaptive"
    EXAM_NAME=""
    EXPECTED_COMMIT="${3:-}"
    CODEX_BIN="${4:-/home/jake/.local/bin/codex}"
    ADAPTIVE_PLAN="${5:-}"
    ;;
  baseline|challenge|stress)
    MODE="legacy"
    EXAM_NAME="$MODE_ARG"
    EXPECTED_COMMIT="${3:-}"
    CODEX_BIN="${4:-/home/jake/.local/bin/codex}"
    ADAPTIVE_PLAN=""
    ;;
  *) echo "mode must be adaptive, baseline, challenge, or stress" >&2; exit 2 ;;
esac
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
[[ "$CODEX_BIN" =~ ^/[A-Za-z0-9._/-]+$ ]] || { echo "invalid Codex executable path" >&2; exit 2; }
case "$MODE" in
  adaptive)
    NPM_SCRIPT="train:adaptive"
    [[ "$ADAPTIVE_PLAN" =~ ^/[A-Za-z0-9._/-]+$ ]] || { echo "adaptive mode requires a safe absolute plan path" >&2; exit 2; }
    [[ -f "$ADAPTIVE_PLAN" && ! -L "$ADAPTIVE_PLAN" ]] || { echo "adaptive plan must be a regular file" >&2; exit 2; }
    ;;
  legacy)
    case "$EXAM_NAME" in
      baseline) NPM_SCRIPT="train:math" ;;
      challenge) NPM_SCRIPT="train:math:challenge" ;;
      stress) NPM_SCRIPT="train:math:stress" ;;
      *) echo "legacy exam must be baseline, challenge, or stress" >&2; exit 2 ;;
    esac
    ;;
esac
mkdir -p "$STATE_DIR" "$LOG_DIR" "$ARTIFACT_ROOT"
chmod 700 "$STATE_DIR" "$LOG_DIR"

write_state() {
  local status="$1"
  local reason="${2:-}"
  local temporary="$STATE_FILE.tmp.$$"
  STATUS="$status" REASON="$reason" RUN_ID="$RUN_ID" MODE="$MODE" EXAM_NAME="$EXAM_NAME" ARTIFACT_ROOT="$ARTIFACT_ROOT" EXPECTED_COMMIT="$EXPECTED_COMMIT" \
    python3 - "$temporary" <<'PY'
import json, os, sys, datetime
payload = {
  "schemaVersion": "cortex.learning_os.remote_math_training_state.v2",
  "status": os.environ["STATUS"],
  "runId": os.environ["RUN_ID"],
  "mode": os.environ["MODE"],
  "exam": os.environ["EXAM_NAME"] or None,
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
  echo "mode=$MODE"
  echo "exam=$EXAM_NAME"
  echo "expected_commit=$EXPECTED_COMMIT"
  echo "started_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  ACTUAL_COMMIT="$(tr -d '[:space:]' < "$REPO_ROOT/CORTEX_LEARNING_OS_SOURCE_COMMIT")"
  echo "actual_commit=$ACTUAL_COMMIT"
  [[ "$ACTUAL_COMMIT" == "$EXPECTED_COMMIT" ]]
  [[ -x "$CODEX_BIN" ]]
  echo "codex_bin=$CODEX_BIN"
  "$CODEX_BIN" --version
  cd "$ROOT"
  export CLOS_SOURCE_COMMIT="$EXPECTED_COMMIT"
  npm test
  if [[ "$MODE" == "adaptive" ]]; then
    TRAIN_ARGS=(--plan "$ADAPTIVE_PLAN" --artifact-root "$ARTIFACT_ROOT" --codex-command "$CODEX_BIN" --source-commit "$EXPECTED_COMMIT")
  else
    TRAIN_ARGS=(--run-id "$RUN_ID" --artifact-root "$ARTIFACT_ROOT" --codex-command "$CODEX_BIN")
  fi
  if npm run "$NPM_SCRIPT" -- "${TRAIN_ARGS[@]}"; then
    TRAIN_EXIT=0
  else
    TRAIN_EXIT=$?
  fi
  echo "training_exit=$TRAIN_EXIT"
  if [[ "$MODE" == "adaptive" ]]; then
    [[ -f "$ARTIFACT_ROOT/session_summary.json" ]]
    OUTCOME="$(node -e 'const s=require(process.argv[1]); process.stdout.write(String(s.status||"unknown")+"\n"+String(Boolean(s.lessonProposed)))' "$ARTIFACT_ROOT/session_summary.json")"
  else
    [[ -f "$ARTIFACT_ROOT/run_summary.json" ]]
    OUTCOME="$(node -e 'const s=require(process.argv[1]); process.stdout.write(String(s.status||"unknown")+"\n"+String(Boolean(s.learningLoopCompleted)))' "$ARTIFACT_ROOT/run_summary.json")"
  fi
  SUMMARY_STATUS="${OUTCOME%%$'\n'*}"
  LEARNING_COMPLETED="${OUTCOME##*$'\n'}"
  echo "summary_status=$SUMMARY_STATUS"
  echo "learning_loop_completed=$LEARNING_COMPLETED"
  if [[ "$MODE" == "adaptive" && "$TRAIN_EXIT" -eq 0 && "$SUMMARY_STATUS" =~ ^(candidate_mastery_delta|candidate_lesson_and_mastery_delta|curriculum_currently_satisfied)$ ]]; then
    write_state candidate_adaptive "adaptive artifacts are terminal; awaiting independent control-plane replay and canonical application"
  elif [[ "$MODE" == "adaptive" && "$TRAIN_EXIT" -eq 4 && "$SUMMARY_STATUS" == "structured_blocker" ]]; then
    write_state candidate_adaptive "adaptive blocker artifacts are terminal; awaiting independent control-plane replay and blocked-state publication"
  elif [[ "$TRAIN_EXIT" -eq 0 && "$SUMMARY_STATUS" == "green" && "$LEARNING_COMPLETED" == "true" ]]; then
    write_state candidate_green "all training and promotion gates passed; awaiting control-plane verification and live registry installation"
  elif [[ "$TRAIN_EXIT" -eq 3 && "$SUMMARY_STATUS" == "blocked_no_observed_mistake" && "$LEARNING_COMPLETED" == "false" ]]; then
    write_state candidate_no_lesson "baseline had no observed mistake; awaiting independent control-plane replay"
  elif [[ "$SUMMARY_STATUS" == blocked_* ]]; then
    write_state completed "training ended without a promoted lesson: $SUMMARY_STATUS"
  else
    write_state failed "training did not produce a gate-qualified lesson: status=$SUMMARY_STATUS exit=$TRAIN_EXIT"
  fi
  echo "finished_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
} >>"$LOG_FILE" 2>&1
trap - ERR
