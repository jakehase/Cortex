#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
LAUNCHER="$SCRIPT_DIR/launch-phd-qualification.sh"
REHEARSAL_ID=""
RECEIPT_OUT=""
PRODUCTION_STATE_ROOT=""
PRODUCTION_REMOTE_STATE_ROOT=""
FORWARD=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --rehearsal-id) REHEARSAL_ID="${2:-}"; shift 2 ;;
    --receipt-out) RECEIPT_OUT="${2:-}"; shift 2 ;;
    --state-root) PRODUCTION_STATE_ROOT="${2:-}"; shift 2 ;;
    --remote-state-root) PRODUCTION_REMOTE_STATE_ROOT="${2:-}"; shift 2 ;;
    *) FORWARD+=("$1"); shift ;;
  esac
done

[[ "$REHEARSAL_ID" =~ ^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$ \
  && "$RECEIPT_OUT" =~ ^/[A-Za-z0-9._/-]+$ \
  && "$PRODUCTION_STATE_ROOT" =~ ^/[A-Za-z0-9._/-]+$ \
  && "$PRODUCTION_REMOTE_STATE_ROOT" =~ ^/[A-Za-z0-9._/-]+$ ]] \
  || { echo "rehearsal ID, receipt, and production state roots are required" >&2; exit 2; }

REHEARSAL_STATE_ROOT="$PRODUCTION_STATE_ROOT/launch-rehearsals/$REHEARSAL_ID/local"
REHEARSAL_REMOTE_STATE_ROOT="$PRODUCTION_REMOTE_STATE_ROOT/launch-rehearsals/$REHEARSAL_ID/remote"

exec "$LAUNCHER" \
  "${FORWARD[@]}" \
  --state-root "$REHEARSAL_STATE_ROOT" \
  --remote-state-root "$REHEARSAL_REMOTE_STATE_ROOT" \
  --production-state-root "$PRODUCTION_STATE_ROOT" \
  --production-remote-state-root "$PRODUCTION_REMOTE_STATE_ROOT" \
  --rehearsal --rehearsal-id "$REHEARSAL_ID" \
  --rehearsal-receipt-out "$RECEIPT_OUT" \
  --no-notify
