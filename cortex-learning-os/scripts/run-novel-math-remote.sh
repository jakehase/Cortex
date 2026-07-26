#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -ne 3 ]]; then
  echo "usage: $0 <validation-id> <seed> <run-root>" >&2
  exit 64
fi

VALIDATION_ID=$1
SEED=$2
RUN_ROOT=$3
CLOS_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
EXPECTED_COMMIT=${CLOS_SOURCE_COMMIT:-}
ARTIFACT_ROOT="$RUN_ROOT/artifacts/$VALIDATION_ID"
LOG_ROOT="$RUN_ROOT/logs"
VERIFICATION_PATH="$RUN_ROOT/independent-verification.json"
COMPLETION_PATH="$RUN_ROOT/completion_state.json"
ARCHIVE_PATH="$RUN_ROOT/$VALIDATION_ID.tar.gz"

mkdir -p "$LOG_ROOT" "$RUN_ROOT/artifacts"

atomic_completion() {
  local status=$1
  local reason=${2:-}
  local mechanical=${3:-false}
  local threshold=${4:-false}
  local integrity=${5:-false}
  local commit
  commit=$(git -C "$CLOS_ROOT" rev-parse HEAD 2>/dev/null || printf '%s' "$EXPECTED_COMMIT")
  STATUS="$status" REASON="$reason" MECHANICAL="$mechanical" THRESHOLD="$threshold" INTEGRITY="$integrity" \
  COMMIT="$commit" VALIDATION_ID="$VALIDATION_ID" ARTIFACT_ROOT="$ARTIFACT_ROOT" RUN_ROOT="$RUN_ROOT" \
  COMPLETION_PATH="$COMPLETION_PATH" python3 - <<'PY'
import json, os, pathlib, tempfile, time
path = pathlib.Path(os.environ['COMPLETION_PATH'])
payload = {
    'schemaVersion': 'cortex.learning_os.novel_math_remote_completion.v0',
    'validationId': os.environ['VALIDATION_ID'],
    'status': os.environ['STATUS'],
    'updatedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
    'terminal': True,
    'head': os.environ['COMMIT'],
    'artifactRoot': os.environ['ARTIFACT_ROOT'],
    'runRoot': os.environ['RUN_ROOT'],
    'mechanicalGreen': os.environ['MECHANICAL'].lower() == 'true',
    'thresholdPass': os.environ['THRESHOLD'].lower() == 'true',
    'artifactIntegrityPass': os.environ['INTEGRITY'].lower() == 'true',
}
if os.environ.get('REASON'):
    payload['reason'] = os.environ['REASON']
path.parent.mkdir(parents=True, exist_ok=True)
fd, temporary = tempfile.mkstemp(prefix=f'.{path.name}.', dir=path.parent)
with os.fdopen(fd, 'w', encoding='utf-8') as handle:
    json.dump(payload, handle, indent=2, sort_keys=True)
    handle.write('\n')
    handle.flush()
    os.fsync(handle.fileno())
os.replace(temporary, path)
PY
}

on_error() {
  local line=$1
  local code=$2
  trap - ERR
  local reason="remote launcher failed at line $line with exit code $code"
  if [[ -f "$ARTIFACT_ROOT/blocker.json" ]]; then
    reason=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("error") or "benchmark blocker")' "$ARTIFACT_ROOT/blocker.json" 2>/dev/null || printf '%s' "$reason")
  fi
  atomic_completion blocked "$reason" false false false
  exit "$code"
}
trap 'on_error "$LINENO" "$?"' ERR

if git -C "$CLOS_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  CURRENT_COMMIT=$(git -C "$CLOS_ROOT" rev-parse HEAD)
  if [[ -n "$(git -C "$CLOS_ROOT" status --porcelain -- .)" ]]; then
    echo "cortex-learning-os source is dirty" >&2
    exit 66
  fi
else
  if [[ -z "$EXPECTED_COMMIT" ]]; then
    echo "CLOS_SOURCE_COMMIT is required for an exported source tree" >&2
    exit 65
  fi
  CURRENT_COMMIT=$EXPECTED_COMMIT
fi
if [[ -n "$EXPECTED_COMMIT" && "$CURRENT_COMMIT" != "$EXPECTED_COMMIT" ]]; then
  echo "source commit mismatch: expected $EXPECTED_COMMIT, current $CURRENT_COMMIT" >&2
  exit 65
fi

printf '%s\n' "$CURRENT_COMMIT" >"$RUN_ROOT/source_commit.txt"
printf '%s\n' "$VALIDATION_ID" >"$RUN_ROOT/validation_id.txt"
printf '%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$RUN_ROOT/started_at.txt"

cd "$CLOS_ROOT"
node src/run-novel-math-validation.mjs \
  --plan-only \
  --validation-id "$VALIDATION_ID" \
  --seed "$SEED" \
  --model gpt-5.6-sol \
  --thinking low \
  --artifact-root "$ARTIFACT_ROOT" \
  >"$LOG_ROOT/01-plan.log" 2>"$LOG_ROOT/01-plan.err"

node src/run-novel-math-validation.mjs \
  --resume \
  --phase immediate \
  --validation-id "$VALIDATION_ID" \
  --artifact-root "$ARTIFACT_ROOT" \
  >"$LOG_ROOT/02-immediate.log" 2>"$LOG_ROOT/02-immediate.err"

RUN_STATUS=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["status"])' "$ARTIFACT_ROOT/campaign_state.json")
if [[ "$RUN_STATUS" == "completed" ]]; then
  DECISION=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("decision", "preregistered_early_no_go"))' "$ARTIFACT_ROOT/analysis.json")
  tar -C "$RUN_ROOT" -czf "$ARCHIVE_PATH" "artifacts/$VALIDATION_ID" logs source_commit.txt validation_id.txt started_at.txt
  sha256sum "$ARCHIVE_PATH" >"$ARCHIVE_PATH.sha256"
  atomic_completion failed "$DECISION" false false false
  trap - ERR
  exit 0
fi
if [[ "$RUN_STATUS" != "awaiting_restart" ]]; then
  echo "unexpected post-immediate status: $RUN_STATUS" >&2
  exit 67
fi

# This is intentionally a second Node process. The immediate process has exited;
# the durability process must reload the frozen program and trusted lesson from disk.
node src/run-novel-math-validation.mjs \
  --resume \
  --phase durability \
  --validation-id "$VALIDATION_ID" \
  --artifact-root "$ARTIFACT_ROOT" \
  >"$LOG_ROOT/03-durability.log" 2>"$LOG_ROOT/03-durability.err"

node src/verify-novel-math-artifacts.mjs \
  --artifact-root "$ARTIFACT_ROOT" \
  --out "$VERIFICATION_PATH" \
  >"$LOG_ROOT/04-independent-verification.log" 2>"$LOG_ROOT/04-independent-verification.err"

read -r INTEGRITY MECHANICAL THRESHOLD DECISION < <(python3 - "$VERIFICATION_PATH" <<'PY'
import json, sys
v = json.load(open(sys.argv[1]))
print(str(bool(v.get('artifactIntegrityPass'))).lower(), str(bool(v.get('mechanicalGreen'))).lower(), str(bool(v.get('thresholdPass'))).lower(), v.get('decision', 'unknown'))
PY
)

tar -C "$RUN_ROOT" -czf "$ARCHIVE_PATH" "artifacts/$VALIDATION_ID" independent-verification.json logs source_commit.txt validation_id.txt started_at.txt
sha256sum "$ARCHIVE_PATH" >"$ARCHIVE_PATH.sha256"
printf '%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$RUN_ROOT/completed_at.txt"

if [[ "$INTEGRITY" == "true" && "$MECHANICAL" == "true" && "$THRESHOLD" == "true" ]]; then
  atomic_completion green "" true true true
else
  atomic_completion failed "$DECISION" "$MECHANICAL" "$THRESHOLD" "$INTEGRITY"
fi
trap - ERR
