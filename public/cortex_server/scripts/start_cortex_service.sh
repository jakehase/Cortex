#!/usr/bin/env bash
set -euo pipefail

cd /root/clawd/public/cortex_server
export PYTHONUNBUFFERED=1

# Cortex's Chroma/ONNX native workers allocate from glibc on several threads.
# The glibc default permits up to 8 arenas per CPU; those per-thread arenas can
# retain 64 MiB mappings after an embedding request has completed.  Keep the
# allocator process-wide and self-trimming so native high-water allocations are
# returned instead of accumulating until CT101 is memory-stalled.
export MALLOC_ARENA_MAX="${MALLOC_ARENA_MAX:-2}"
export MALLOC_TRIM_THRESHOLD_="${MALLOC_TRIM_THRESHOLD_:-131072}"
export MALLOC_TOP_PAD_="${MALLOC_TOP_PAD_:-131072}"

export CORTEX_HOST="${CORTEX_HOST:-0.0.0.0}"
export CORTEX_PORT="${CORTEX_PORT:-8000}"
export CORTEX_ENV="${CORTEX_ENV:-production}"
if [[ "${CORTEX_ENV}" != "production" ]]; then
  echo "The canonical Cortex host launcher requires CORTEX_ENV=production" >&2
  exit 1
fi

export ORCHESTRATOR_RUNTIME_DELIVERY_ROOT="${ORCHESTRATOR_RUNTIME_DELIVERY_ROOT:-/opt/clawdbot/state/runtime_delivery}"
if [[ "${ORCHESTRATOR_RUNTIME_DELIVERY_ROOT}" != /* ]]; then
  echo "ORCHESTRATOR_RUNTIME_DELIVERY_ROOT must be an absolute path" >&2
  exit 1
fi
# The canonical host path always owns a physically allocated rollback reserve;
# an inherited false value must never silently weaken this default.
export CORTEX_RUNTIME_DELIVERY_PREALLOCATE_RECOVERY_RESERVE=true

preallocate_runtime_delivery_recovery_reserve() {
  /usr/bin/python3 -c 'import os; from pathlib import Path; from cortex_server.runtime.runtime_delivery_quota import preallocate_runtime_delivery_recovery_reserve; preallocate_runtime_delivery_recovery_reserve(Path(os.environ["ORCHESTRATOR_RUNTIME_DELIVERY_ROOT"]))'
}

CORTEX_LIMIT_CONCURRENCY="${CORTEX_LIMIT_CONCURRENCY:-128}"
if [[ ! "${CORTEX_LIMIT_CONCURRENCY}" =~ ^[0-9]+$ ]] || \
   (( CORTEX_LIMIT_CONCURRENCY < 1 || CORTEX_LIMIT_CONCURRENCY > 128 )); then
  echo "CORTEX_LIMIT_CONCURRENCY must be an integer between 1 and 128" >&2
  exit 1
fi

: "${CORTEX_RELEASE_VERIFIER_RECIPIENT_SECRET:?set the verifier recipient secret}"
: "${CORTEX_RELEASE_MANAGER_RECIPIENT_SECRET:?set the manager recipient secret}"
: "${CORTEX_RELEASE_VERIFIER_ID:?set the verifier attestation ID}"
: "${CORTEX_RELEASE_VERIFIER_ATTESTATION_SECRET:?set the verifier attestation secret}"
: "${CORTEX_RELEASE_ARTIFACT_WRITE_TOKEN:?set the verifier-only artifact transport token}"
: "${CORTEX_RELEASE_VERIFIER_STATE_DIR:?set the durable verifier controller state directory}"
: "${CORTEX_RELEASE_MANAGER_STATE_DIR:?set the durable manager controller state directory}"

normalize_controller_state_dir() {
  local variable_name="$1"
  local configured="$2"
  local normalized
  if [[ "${configured}" != /* ]]; then
    echo "${variable_name} must be an absolute path" >&2
    return 1
  fi
  normalized="$(/usr/bin/realpath -m -- "${configured}")"
  case "${normalized}" in
    /tmp|/tmp/*|/var/tmp|/var/tmp/*|/run|/run/*|/dev/shm|/dev/shm/*)
      echo "${variable_name} must use durable storage, not ${normalized}" >&2
      return 1
      ;;
  esac
  printf '%s\n' "${normalized}"
}

CORTEX_RELEASE_VERIFIER_STATE_DIR="$(normalize_controller_state_dir \
  CORTEX_RELEASE_VERIFIER_STATE_DIR "${CORTEX_RELEASE_VERIFIER_STATE_DIR}")"
CORTEX_RELEASE_MANAGER_STATE_DIR="$(normalize_controller_state_dir \
  CORTEX_RELEASE_MANAGER_STATE_DIR "${CORTEX_RELEASE_MANAGER_STATE_DIR}")"
if [[ "${CORTEX_RELEASE_VERIFIER_STATE_DIR}" == "${CORTEX_RELEASE_MANAGER_STATE_DIR}" ]]; then
  echo "release verifier and manager state directories must be distinct" >&2
  exit 1
fi

# Complete the allocation, file fsync, directory fsync, allocated-block check,
# and quota/readiness projection before any serving process is started.
preallocate_runtime_delivery_recovery_reserve

export CORTEX_BASE_URL="${CORTEX_BASE_URL:-http://127.0.0.1:${CORTEX_PORT}}"
export CORTEX_RELEASE_MEASUREMENT_URL="${CORTEX_RELEASE_MEASUREMENT_URL:-${CORTEX_BASE_URL}/release-observation}"
export CORTEX_RELEASE_VERIFIER_HEALTH_URL="${CORTEX_RELEASE_VERIFIER_HEALTH_URL:-http://127.0.0.1:8891/ready}"
export CORTEX_RELEASE_MANAGER_HEALTH_URL="${CORTEX_RELEASE_MANAGER_HEALTH_URL:-http://127.0.0.1:8892/ready}"

child_pids=()
cleanup() {
  if (( ${#child_pids[@]} )); then
    kill -TERM "${child_pids[@]}" 2>/dev/null || true
    wait "${child_pids[@]}" 2>/dev/null || true
  fi
}
trap cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT

/usr/bin/env -i \
PATH=/usr/bin:/bin \
LANG=C.UTF-8 \
PYTHONUNBUFFERED=1 \
MALLOC_ARENA_MAX="${MALLOC_ARENA_MAX}" \
MALLOC_TRIM_THRESHOLD_="${MALLOC_TRIM_THRESHOLD_}" \
MALLOC_TOP_PAD_="${MALLOC_TOP_PAD_}" \
CORTEX_ENV="${CORTEX_ENV}" \
CORTEX_BASE_URL="${CORTEX_BASE_URL}" \
CORTEX_RELEASE_MEASUREMENT_URL="${CORTEX_RELEASE_MEASUREMENT_URL}" \
CORTEX_RELEASE_CONTROLLER_REQUIRE_EXISTING_STATE=true \
CORTEX_RELEASE_CONTROLLER_ROLE=verifier \
CORTEX_RELEASE_CONTROLLER_STATE_DIR="${CORTEX_RELEASE_VERIFIER_STATE_DIR}" \
CORTEX_HANDOFF_RECIPIENT=release-verifier \
CORTEX_HANDOFF_RECIPIENT_SECRET="${CORTEX_RELEASE_VERIFIER_RECIPIENT_SECRET}" \
CORTEX_HANDOFF_HEALTH_PORT="${CORTEX_RELEASE_VERIFIER_HEALTH_PORT:-8891}" \
CORTEX_HANDOFF_HEALTH_MAX_CONNECTIONS="${CORTEX_HANDOFF_HEALTH_MAX_CONNECTIONS:-16}" \
CORTEX_HANDOFF_HEALTH_SOCKET_TIMEOUT_SECONDS="${CORTEX_HANDOFF_HEALTH_SOCKET_TIMEOUT_SECONDS:-2}" \
CORTEX_HANDOFF_READY_MAX_AGE_SECONDS="${CORTEX_HANDOFF_READY_MAX_AGE_SECONDS:-30}" \
CORTEX_HANDOFF_POLL_SECONDS="${CORTEX_HANDOFF_POLL_SECONDS:-3}" \
CORTEX_RELEASE_CLOCK_DIVERGENCE_SECONDS="${CORTEX_RELEASE_CLOCK_DIVERGENCE_SECONDS:-5}" \
CORTEX_RELEASE_VERIFIER_ID="${CORTEX_RELEASE_VERIFIER_ID}" \
CORTEX_RELEASE_VERIFIER_ATTESTATION_SECRET="${CORTEX_RELEASE_VERIFIER_ATTESTATION_SECRET}" \
CORTEX_RELEASE_ARTIFACT_WRITE_TOKEN="${CORTEX_RELEASE_ARTIFACT_WRITE_TOKEN}" \
CORTEX_RELEASE_ARTIFACT_WRITE_TOKEN_HEADER="${CORTEX_RELEASE_ARTIFACT_WRITE_TOKEN_HEADER:-x-cortex-release-artifact-token}" \
  /usr/bin/python3 -m cortex_server.runtime.release_verifier_worker &
child_pids+=("$!")

/usr/bin/env -i \
PATH=/usr/bin:/bin \
LANG=C.UTF-8 \
PYTHONUNBUFFERED=1 \
MALLOC_ARENA_MAX="${MALLOC_ARENA_MAX}" \
MALLOC_TRIM_THRESHOLD_="${MALLOC_TRIM_THRESHOLD_}" \
MALLOC_TOP_PAD_="${MALLOC_TOP_PAD_}" \
CORTEX_ENV="${CORTEX_ENV}" \
CORTEX_BASE_URL="${CORTEX_BASE_URL}" \
CORTEX_RELEASE_MEASUREMENT_URL="${CORTEX_RELEASE_MEASUREMENT_URL}" \
CORTEX_RELEASE_CONTROLLER_REQUIRE_EXISTING_STATE=true \
CORTEX_RELEASE_CONTROLLER_ROLE=manager \
CORTEX_RELEASE_CONTROLLER_STATE_DIR="${CORTEX_RELEASE_MANAGER_STATE_DIR}" \
CORTEX_HANDOFF_RECIPIENT=release-manager \
CORTEX_HANDOFF_RECIPIENT_SECRET="${CORTEX_RELEASE_MANAGER_RECIPIENT_SECRET}" \
CORTEX_HANDOFF_HEALTH_PORT="${CORTEX_RELEASE_MANAGER_HEALTH_PORT:-8892}" \
CORTEX_HANDOFF_HEALTH_MAX_CONNECTIONS="${CORTEX_HANDOFF_HEALTH_MAX_CONNECTIONS:-16}" \
CORTEX_HANDOFF_HEALTH_SOCKET_TIMEOUT_SECONDS="${CORTEX_HANDOFF_HEALTH_SOCKET_TIMEOUT_SECONDS:-2}" \
CORTEX_HANDOFF_READY_MAX_AGE_SECONDS="${CORTEX_HANDOFF_READY_MAX_AGE_SECONDS:-30}" \
CORTEX_HANDOFF_POLL_SECONDS="${CORTEX_HANDOFF_POLL_SECONDS:-3}" \
CORTEX_RELEASE_CLOCK_DIVERGENCE_SECONDS="${CORTEX_RELEASE_CLOCK_DIVERGENCE_SECONDS:-5}" \
  /usr/bin/python3 -m cortex_server.runtime.release_manager_worker &
child_pids+=("$!")

/usr/bin/python3 -m uvicorn cortex_server.main:app \
  --host "${CORTEX_HOST}" \
  --port "${CORTEX_PORT}" \
  --limit-concurrency "${CORTEX_LIMIT_CONCURRENCY}" \
  --timeout-keep-alive 5 \
  --ws-max-size 4096 &
child_pids+=("$!")

set +e
wait -n "${child_pids[@]}"
status=$?
set -e
exit "${status}"
