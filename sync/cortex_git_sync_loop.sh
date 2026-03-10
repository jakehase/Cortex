#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="${REPO_ROOT:-/opt/clawdbot}"
SYNC_INTERVAL_SECONDS="${SYNC_INTERVAL_SECONDS:-300}"

while true; do
  "$REPO_ROOT/sync/cortex_git_sync.sh" || true
  sleep "$SYNC_INTERVAL_SECONDS"
done
