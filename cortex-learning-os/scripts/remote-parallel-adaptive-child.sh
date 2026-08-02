#!/usr/bin/env bash
set -Eeuo pipefail

WAVE_ID="${1:-}"
RUN_ID="${2:-}"
EXPECTED_COMMIT="${3:-}"
EXPECTED_TREE="${4:-}"
CODEX_BIN="${5:-/home/jake/.local/bin/codex}"
PLAN_PATH="${6:-}"
GRAPH_PATH="${7:-/home/jake/clawd-remote/cortex-learning-os/capsules/math-foundations/curriculum.phd-trajectory-v1.graph.json}"
POLICY_PATH="${8:-/home/jake/clawd-remote/cortex-learning-os/policies/adaptive-math-phd-v1.json}"
CAPSULE_PATH="${9:-/home/jake/clawd-remote/cortex-learning-os/capsules/math-foundations/capsule.json}"
ASSESSMENT_BANK_PATH="${10:-}"
REPO_ROOT="/home/jake/clawd-remote"
CLOS_ROOT="$REPO_ROOT/cortex-learning-os"
STATE_ROOT="$REPO_ROOT/state/cortex-learning-os/waves/$WAVE_ID"
ARTIFACT_ROOT="$CLOS_ROOT/artifacts/parallel-waves/$WAVE_ID/children/$RUN_ID"
STATE_FILE="$STATE_ROOT/$RUN_ID.json"
LOG_ROOT="$REPO_ROOT/logs/cortex-learning-os/waves/$WAVE_ID"
LOG_FILE="$LOG_ROOT/$RUN_ID.log"

[[ "$WAVE_ID" =~ ^math-wave-[0-9]{8}T[0-9]{6}Z-[a-z0-9]{6}$ ]] || { echo "invalid wave id" >&2; exit 2; }
[[ "$RUN_ID" =~ ^${WAVE_ID}[.]c0[1-8]$ ]] || { echo "invalid parallel child run id" >&2; exit 2; }
[[ "$EXPECTED_COMMIT" =~ ^[0-9a-f]{40}$ ]] || { echo "invalid expected commit" >&2; exit 2; }
[[ "$EXPECTED_TREE" =~ ^[0-9a-f]{40}$ ]] || { echo "invalid expected tree" >&2; exit 2; }
[[ "$CODEX_BIN" =~ ^/[A-Za-z0-9._/-]+$ ]] || { echo "invalid Codex executable path" >&2; exit 2; }
[[ "$PLAN_PATH" =~ ^/[A-Za-z0-9._/-]+$ ]] || { echo "invalid child plan path" >&2; exit 2; }
[[ "$ASSESSMENT_BANK_PATH" =~ ^/[A-Za-z0-9._/-]+$ ]] || { echo "invalid independent assessment bank path" >&2; exit 2; }
[[ "$GRAPH_PATH" =~ ^/[A-Za-z0-9._/-]+$ && "$POLICY_PATH" =~ ^/[A-Za-z0-9._/-]+$ && "$CAPSULE_PATH" =~ ^/[A-Za-z0-9._/-]+$ ]] || { echo "invalid adaptive input path" >&2; exit 2; }
[[ -f "$PLAN_PATH" && ! -L "$PLAN_PATH" && -r "$PLAN_PATH" ]] || { echo "child plan must be a readable regular file" >&2; exit 2; }
for input_path in "$GRAPH_PATH" "$POLICY_PATH" "$CAPSULE_PATH"; do
  [[ -f "$input_path" && ! -L "$input_path" && -r "$input_path" ]] || { echo "adaptive input must be a readable regular file: $input_path" >&2; exit 2; }
done
[[ -f "$ASSESSMENT_BANK_PATH" && ! -L "$ASSESSMENT_BANK_PATH" && -r "$ASSESSMENT_BANK_PATH" ]] || { echo "independent assessment bank must be a readable regular file" >&2; exit 2; }

install -d -m 700 "$STATE_ROOT" "$LOG_ROOT" "$ARTIFACT_ROOT"

write_state() {
  local status="$1"
  local reason="${2:-}"
  local temporary="$STATE_FILE.tmp.$$"
  STATUS="$status" REASON="$reason" WAVE_ID="$WAVE_ID" RUN_ID="$RUN_ID" ARTIFACT_ROOT="$ARTIFACT_ROOT" \
  EXPECTED_COMMIT="$EXPECTED_COMMIT" EXPECTED_TREE="$EXPECTED_TREE" python3 - "$temporary" <<'PY'
import datetime
import json
import os
import sys

payload = {
    "schemaVersion": "cortex.learning_os.remote_parallel_child_state.v1",
    "waveId": os.environ["WAVE_ID"],
    "runId": os.environ["RUN_ID"],
    "status": os.environ["STATUS"],
    "reason": os.environ["REASON"][:2000],
    "artifactRoot": os.environ["ARTIFACT_ROOT"],
    "sourceCommit": os.environ["EXPECTED_COMMIT"],
    "sourceTree": os.environ["EXPECTED_TREE"],
    "placement": "hetzner",
    "updatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z"),
}
with open(sys.argv[1], "w", encoding="utf-8") as handle:
    json.dump(payload, handle, indent=2, sort_keys=True)
    handle.write("\n")
PY
  chmod 600 "$temporary"
  mv -f "$temporary" "$STATE_FILE"
}

on_error() {
  local exit_code=$?
  write_state failed "parallel child infrastructure or execution failure (exit $exit_code); inspect $LOG_FILE"
  exit "$exit_code"
}
trap on_error ERR

write_state running "detached Hetzner child is collecting bounded acquisition or correction evidence"
{
  if [[ -f "$REPO_ROOT/CORTEX_LEARNING_OS_SOURCE_COMMIT" ]]; then
    ACTUAL_COMMIT="$(tr -d '[:space:]' < "$REPO_ROOT/CORTEX_LEARNING_OS_SOURCE_COMMIT")"
  else
    ACTUAL_COMMIT="$(git -C "$REPO_ROOT" rev-parse HEAD)"
  fi
  CHECKED_OUT_COMMIT="$(git -C "$REPO_ROOT" rev-parse HEAD)"
  ACTUAL_TREE="$(git -C "$REPO_ROOT" rev-parse "$ACTUAL_COMMIT^{tree}")"
  [[ "$ACTUAL_COMMIT" == "$EXPECTED_COMMIT" ]]
  [[ "$CHECKED_OUT_COMMIT" == "$EXPECTED_COMMIT" ]]
  [[ "$ACTUAL_TREE" == "$EXPECTED_TREE" ]]
  [[ -x "$CODEX_BIN" ]]
  PLAN_RUN_ID="$(node -e 'const p=require(process.argv[1]); process.stdout.write(String(p.runId||""))' "$PLAN_PATH")"
  PLAN_PROVIDER="$(node -e 'const p=require(process.argv[1]); process.stdout.write(String(p.modelRuntime?.provider||""))' "$PLAN_PATH")"
  PLAN_SANDBOX="$(node -e 'const p=require(process.argv[1]); process.stdout.write(String(p.modelRuntime?.sandbox||""))' "$PLAN_PATH")"
  PLAN_TOOLS="$(node -e 'const p=require(process.argv[1]); process.stdout.write(String(p.modelRuntime?.toolsAllowed))' "$PLAN_PATH")"
  [[ "$PLAN_RUN_ID" == "$RUN_ID" ]]
  [[ "$PLAN_PROVIDER" == "openai-codex" && "$PLAN_SANDBOX" == "read-only" && "$PLAN_TOOLS" == "false" ]]
  cd "$CLOS_ROOT"
  export CLOS_SOURCE_COMMIT="$EXPECTED_COMMIT"
  if npm run train:adaptive -- \
    --plan "$PLAN_PATH" \
    --artifact-root "$ARTIFACT_ROOT" \
    --codex-command "$CODEX_BIN" \
    --source-commit "$EXPECTED_COMMIT" \
    --graph "$GRAPH_PATH" \
    --policy "$POLICY_PATH" \
    --capsule "$CAPSULE_PATH" \
    --assessment-bank "$ASSESSMENT_BANK_PATH"; then
    TRAIN_EXIT=0
  else
    TRAIN_EXIT=$?
  fi
  [[ -f "$ARTIFACT_ROOT/session_summary.json" ]]
  SUMMARY_STATUS="$(node -e 'const s=require(process.argv[1]); process.stdout.write(String(s.status||""))' "$ARTIFACT_ROOT/session_summary.json")"
  if [[ "$TRAIN_EXIT" -eq 0 && "$SUMMARY_STATUS" =~ ^(candidate_acquisition_delta|candidate_lesson_and_acquisition_delta)$ ]]; then
    write_state candidate "child artifacts are terminal and await wave-wide independent replay"
  elif [[ "$TRAIN_EXIT" -eq 4 && "$SUMMARY_STATUS" == "structured_blocker" ]]; then
    write_state candidate "structured blocker artifacts await fail-closed wave-wide replay"
  else
    write_state failed "child did not produce a supported acquisition artifact: status=$SUMMARY_STATUS exit=$TRAIN_EXIT"
  fi
} >>"$LOG_FILE" 2>&1
trap - ERR
