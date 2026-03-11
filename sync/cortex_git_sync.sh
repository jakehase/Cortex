#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="${REPO_ROOT:-/opt/clawdbot}"
RUNTIME_DIR="${RUNTIME_DIR:-$REPO_ROOT/.sync-runtime}"
LOG_FILE="${LOG_FILE:-$RUNTIME_DIR/autosync.log}"
LOCK_FILE="${LOCK_FILE:-$RUNTIME_DIR/autosync.lock}"
LAST_COMMIT_TS_FILE="${LAST_COMMIT_TS_FILE:-$RUNTIME_DIR/last_commit_epoch}"
DISABLE_FILE="${DISABLE_FILE:-$REPO_ROOT/.autosync-disabled}"
DEBOUNCE_SECONDS="${DEBOUNCE_SECONDS:-300}"
PUSH_MAX_RETRIES="${PUSH_MAX_RETRIES:-4}"
SYNC_BRANCH="${SYNC_BRANCH:-main}"
GITHUB_TOKEN_FILE="${GITHUB_TOKEN_FILE:-$REPO_ROOT/.sync-runtime/github_token}"
DRY_RUN=0

if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=1
fi

mkdir -p "$RUNTIME_DIR"

log() {
  local msg="$1"
  printf '%s %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$msg" | tee -a "$LOG_FILE"
}

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  log "lock_busy skip"
  exit 0
fi

if [[ -f "$DISABLE_FILE" ]]; then
  log "autosync_disabled file=$DISABLE_FILE"
  exit 0
fi

if [[ ! -d "$REPO_ROOT/.git" ]]; then
  log "error missing_git_repo repo_root=$REPO_ROOT"
  exit 2
fi

cd "$REPO_ROOT"

if [[ -x "$REPO_ROOT/sync/pull_from_cortex_vm.sh" ]]; then
  if "$REPO_ROOT/sync/pull_from_cortex_vm.sh" >> "$LOG_FILE" 2>&1; then
    log "canonical_pull_done"
  else
    log "canonical_pull_failed"
    exit 5
  fi
fi

EXPORT_JSON="$RUNTIME_DIR/export_result.json"
python3 "$REPO_ROOT/sync/build_public_export.py" > "$EXPORT_JSON"
log "export_done file=$EXPORT_JSON"

if ! python3 "$REPO_ROOT/sync/scan_public_secrets.py" --root "$REPO_ROOT/public" >> "$LOG_FILE" 2>&1; then
  log "secret_scan_failed"
  exit 3
fi
log "secret_scan_pass"

# Stage only public export (fail-closed against accidental adds)
git add public

if git diff --cached --quiet; then
  log "no_changes"
  exit 0
fi

now_epoch="$(date +%s)"
last_epoch=0
if [[ -f "$LAST_COMMIT_TS_FILE" ]]; then
  last_epoch="$(cat "$LAST_COMMIT_TS_FILE" || echo 0)"
fi

if (( now_epoch - last_epoch < DEBOUNCE_SECONDS )); then
  log "debounce_skip seconds_since_last=$((now_epoch-last_epoch)) threshold=$DEBOUNCE_SECONDS"
  git reset -q HEAD public
  exit 0
fi

if (( DRY_RUN == 1 )); then
  log "dry_run_commit_preview"
  git diff --cached --name-only | sed 's/^/would_commit: /' | tee -a "$LOG_FILE"
  git reset -q HEAD public
  exit 0
fi

commit_msg="sync(public): $(date -u +'%Y-%m-%dT%H:%M:%SZ')"
git commit -m "$commit_msg" >/dev/null
printf '%s' "$now_epoch" > "$LAST_COMMIT_TS_FILE"
log "commit_created msg='$commit_msg'"

if git remote get-url origin >/dev/null 2>&1; then
  if [[ -z "${GITHUB_TOKEN:-}${GH_TOKEN:-}" && -f "$GITHUB_TOKEN_FILE" ]]; then
    export GITHUB_TOKEN="$(tr -d '\r\n' < "$GITHUB_TOKEN_FILE")"
    export GH_TOKEN="$GITHUB_TOKEN"
    log "github_token_loaded file=$GITHUB_TOKEN_FILE"
    if command -v gh >/dev/null 2>&1; then
      gh auth status >/dev/null 2>&1 || true
    fi
  fi

  attempt=1
  delay=2
  while true; do
    if git push origin "HEAD:$SYNC_BRANCH" >> "$LOG_FILE" 2>&1; then
      log "push_success branch=$SYNC_BRANCH attempt=$attempt"
      break
    fi

    if (( attempt >= PUSH_MAX_RETRIES )); then
      log "push_failed attempts=$attempt"
      exit 4
    fi

    log "push_retry attempt=$attempt sleep=${delay}s"
    sleep "$delay"
    delay=$((delay * 2))
    attempt=$((attempt + 1))
  done
else
  log "push_skipped no_origin_remote"
fi
