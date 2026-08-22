#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

STATE_DIR="/root/.openclaw"
RECOVERY_DIR="/root/recovery"
RUN_TS="$(date -u +%Y%m%dT%H%M%SZ)-$$"
RUN_DIR="${RECOVERY_DIR}/restore-${RUN_TS}"
LOG_FILE="${RUN_DIR}/restore.log"

MODE=""
SOURCE_PATH=""
EXECUTE=0

CANDIDATE_SOURCE=""
SOURCE_KIND=""
SAFETY_BACKUP_JSON=""
ORIGINAL_STATE_BACKUP=""
STATE_SWITCHED=0
STATE_OWNER="0:0"

usage() {
  cat <<'EOF'
Usage:
  openclaw-safe-restore.sh (--source-archive PATH | --source-state-dir PATH) [--execute]

Purpose:
  Safely validate and, if requested, restore a full OpenClaw state directory.

Default behavior:
  Dry-run only. The script stages and validates the source but makes NO live changes
  unless --execute is provided.

Supported source types:
  --source-archive PATH   OpenClaw backup archive (.tar.gz) or raw tar archive
                          (.tar.gz/.tgz/.tar.zst/.tzst/.zst) containing a full
                          OpenClaw state tree.
  --source-state-dir PATH Path to an already-extracted state directory.

Examples:
  # Safe validation only (no changes)
  scripts/openclaw-safe-restore.sh --source-archive /root/recovery/openclaw-backup.tar.gz

  # Validate a raw extracted state directory
  scripts/openclaw-safe-restore.sh --source-state-dir /root/recovery/vm102/openclaw_state

  # Real restore with rollback protection
  scripts/openclaw-safe-restore.sh --source-archive /root/recovery/openclaw-backup.tar.gz --execute

Behavior when --execute is used:
  - creates a fresh verified safety backup of the current CT101 state
  - stops the gateway
  - swaps the entire ~/.openclaw tree as one unit
  - runs `openclaw doctor --non-interactive`
  - starts the gateway and waits for `RPC probe: ok`
  - automatically rolls back if startup/verification fails
EOF
}

log() {
  mkdir -p "$RUN_DIR"
  printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" | tee -a "$LOG_FILE"
}

fail() {
  log "ERROR: $*"
  exit 1
}

cleanup_on_error() {
  local rc=$?
  if [[ $rc -eq 0 ]]; then
    return 0
  fi

  log "Failure trapped (exit $rc)."

  if [[ "$STATE_SWITCHED" -eq 1 && -n "$ORIGINAL_STATE_BACKUP" && -d "$ORIGINAL_STATE_BACKUP" ]]; then
    log "Attempting automatic rollback."
    openclaw gateway stop >>"$LOG_FILE" 2>&1 || true

    if [[ -e "$STATE_DIR" ]]; then
      mv "$STATE_DIR" "${RUN_DIR}/failed-state-after-restore" >>"$LOG_FILE" 2>&1 || true
    fi

    mv "$ORIGINAL_STATE_BACKUP" "$STATE_DIR" >>"$LOG_FILE" 2>&1 || true
    chown -R "$STATE_OWNER" "$STATE_DIR" >>"$LOG_FILE" 2>&1 || true
    openclaw doctor --non-interactive >>"$LOG_FILE" 2>&1 || true
    openclaw gateway start >>"$LOG_FILE" 2>&1 || true
    verify_gateway 60 || true
    log "Rollback attempt finished."
  fi

  exit "$rc"
}
trap cleanup_on_error EXIT

verify_gateway() {
  local timeout_secs="${1:-90}"
  local waited=0
  local status_file="${RUN_DIR}/gateway-status-latest.txt"

  while (( waited < timeout_secs )); do
    if openclaw gateway status >"$status_file" 2>&1; then
      if grep -q 'Runtime: running' "$status_file" && grep -q 'RPC probe: ok' "$status_file"; then
        log "Gateway verification passed."
        return 0
      fi
    fi
    sleep 3
    waited=$(( waited + 3 ))
  done

  log "Gateway verification failed after ${timeout_secs}s. Last status follows:"
  sed -n '1,160p' "$status_file" | tee -a "$LOG_FILE" >&2 || true
  return 1
}

extract_archive() {
  local archive="$1"
  local extract_dir="${RUN_DIR}/extract"
  mkdir -p "$extract_dir"

  case "$archive" in
    *.tar.gz|*.tgz)
      tar -xzf "$archive" -C "$extract_dir"
      ;;
    *.tar.zst|*.tzst|*.zst)
      tar --zstd -xf "$archive" -C "$extract_dir"
      ;;
    *)
      fail "Unsupported archive format: $archive"
      ;;
  esac
}

resolve_state_dir_from_extraction() {
  local extract_dir="${RUN_DIR}/extract"
  local found=""

  found="$(find "$extract_dir" -type d -path '*/payload/posix/root/.openclaw' | head -n 1 || true)"
  if [[ -n "$found" ]]; then
    SOURCE_KIND="official-openclaw-archive"
    CANDIDATE_SOURCE="$found"
    return 0
  fi

  found="$(find "$extract_dir" -type d -name 'openclaw_state' | head -n 1 || true)"
  if [[ -n "$found" ]]; then
    SOURCE_KIND="raw-archive-openclaw_state"
    CANDIDATE_SOURCE="$found"
    return 0
  fi

  found="$(find "$extract_dir" -mindepth 1 -maxdepth 3 -type d -name '.openclaw' | head -n 1 || true)"
  if [[ -n "$found" ]]; then
    SOURCE_KIND="raw-archive-dot-openclaw"
    CANDIDATE_SOURCE="$found"
    return 0
  fi

  fail "Could not locate a restored OpenClaw state directory inside extracted archive."
}

validate_source_tree() {
  local src="$1"
  local -a hard_required=(
    agents
    auth-profiles.json
    auto_ops
    credentials
    identity
    logs
    openclaw.json
    workspace
    workspace_baseline
  )
  local -a warn_if_missing=(
    canvas
    cron
    devices
    memory
    skills
    identity/device-auth.json
    identity/device.json
  )
  local missing=()
  local warned=()

  for item in "${hard_required[@]}"; do
    if [[ ! -e "$src/$item" ]]; then
      missing+=("$item")
    fi
  done

  if (( ${#missing[@]} > 0 )); then
    log "Source is NOT a seamless full-state restore candidate. Missing required items: ${missing[*]}"
    return 1
  fi

  for item in "${warn_if_missing[@]}"; do
    if [[ ! -e "$src/$item" ]]; then
      warned+=("$item")
    fi
  done

  log "Required restore items are present."
  if (( ${#warned[@]} > 0 )); then
    log "Warnings: source is missing non-fatal items: ${warned[*]}"
  fi

  if [[ ! -d "$src/credentials/whatsapp" ]]; then
    log "Warning: credentials/whatsapp is missing; channel reconnect may be required."
  fi
}

stage_candidate_copy() {
  local src="$1"
  local staged="${RUN_DIR}/candidate/.openclaw"
  mkdir -p "${RUN_DIR}/candidate"
  rm -rf "$staged"
  mkdir -p "$staged"
  (
    cd "$src"
    tar -cf - .
  ) | (
    cd "$staged"
    tar -xf -
  )
  printf '%s' "$staged"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --source-archive)
      [[ -z "$MODE" ]] || fail "Choose exactly one source mode."
      MODE="archive"
      SOURCE_PATH="${2:-}"
      shift 2
      ;;
    --source-state-dir)
      [[ -z "$MODE" ]] || fail "Choose exactly one source mode."
      MODE="state-dir"
      SOURCE_PATH="${2:-}"
      shift 2
      ;;
    --execute)
      EXECUTE=1
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      fail "Unknown argument: $1"
      ;;
  esac
done

[[ -n "$MODE" ]] || { usage; exit 1; }
[[ -n "$SOURCE_PATH" ]] || fail "A source path is required."
[[ -e "$SOURCE_PATH" ]] || fail "Source path does not exist: $SOURCE_PATH"
[[ -d "$RECOVERY_DIR" ]] || mkdir -p "$RECOVERY_DIR"
[[ -d "$STATE_DIR" ]] || fail "Live state dir missing: $STATE_DIR"
[[ -x "$(command -v openclaw)" ]] || fail "openclaw CLI not found in PATH"

STATE_OWNER="$(stat -c '%u:%g' "$STATE_DIR")"
mkdir -p "$RUN_DIR"
: > "$LOG_FILE"

log "Starting guarded OpenClaw restore workflow."
log "Mode: $MODE"
log "Source path: $SOURCE_PATH"
log "Execute live restore: $EXECUTE"
log "Run directory: $RUN_DIR"

if [[ "$MODE" == "archive" ]]; then
  log "Trying official OpenClaw archive verification first."
  if openclaw backup verify "$SOURCE_PATH" --json >"${RUN_DIR}/source-verify.json" 2>>"$LOG_FILE"; then
    SAFETY_BACKUP_JSON="${RUN_DIR}/source-verify.json"
    log "Archive verified as an official OpenClaw backup."
  else
    log "Archive is not an official OpenClaw backup (or verify failed); treating as a raw tar archive."
  fi

  extract_archive "$SOURCE_PATH"
  resolve_state_dir_from_extraction
else
  SOURCE_KIND="state-dir"
  CANDIDATE_SOURCE="$SOURCE_PATH"
fi

log "Resolved source kind: $SOURCE_KIND"
log "Resolved state dir: $CANDIDATE_SOURCE"

validate_source_tree "$CANDIDATE_SOURCE"
STAGED_CANDIDATE="$(stage_candidate_copy "$CANDIDATE_SOURCE")"

log "Candidate staged at: $STAGED_CANDIDATE"
log "Candidate top-level contents:"
find "$STAGED_CANDIDATE" -maxdepth 1 -mindepth 1 -printf '  - %f\n' | sort | tee -a "$LOG_FILE"

if [[ "$EXECUTE" -ne 1 ]]; then
  log "Dry-run only. No live changes made."
  log "If you later want to execute, rerun with --execute."
  exit 0
fi

log "Creating fresh verified safety backup of current live state."
openclaw backup create --verify --output "$RECOVERY_DIR" --json >"${RUN_DIR}/pre-restore-safety-backup.json"
log "Safety backup metadata written to ${RUN_DIR}/pre-restore-safety-backup.json"

log "Capturing pre-restore status snapshots."
openclaw gateway status >"${RUN_DIR}/pre-gateway-status.txt" 2>&1 || true
openclaw status >"${RUN_DIR}/pre-openclaw-status.txt" 2>&1 || true

log "Stopping gateway."
openclaw gateway stop >>"$LOG_FILE" 2>&1

ORIGINAL_STATE_BACKUP="${RECOVERY_DIR}/live-pre-restore-${RUN_TS}"
log "Moving current live state to ${ORIGINAL_STATE_BACKUP}"
mv "$STATE_DIR" "$ORIGINAL_STATE_BACKUP"

log "Promoting staged candidate to live state dir."
mv "$STAGED_CANDIDATE" "$STATE_DIR"
STATE_SWITCHED=1

log "Fixing ownership to ${STATE_OWNER}."
chown -R "$STATE_OWNER" "$STATE_DIR"

log "Running openclaw doctor --non-interactive."
openclaw doctor --non-interactive >"${RUN_DIR}/doctor.txt" 2>&1

log "Starting gateway."
openclaw gateway start >>"$LOG_FILE" 2>&1
verify_gateway 90

log "Capturing post-restore status snapshots."
openclaw gateway status >"${RUN_DIR}/post-gateway-status.txt" 2>&1 || true
openclaw status >"${RUN_DIR}/post-openclaw-status.txt" 2>&1 || true

STATE_SWITCHED=0
log "Restore completed successfully. Original live state remains at ${ORIGINAL_STATE_BACKUP} until you remove it manually."
