#!/usr/bin/env bash
set -euo pipefail

ROOT="/opt/clawdbot"
REMOTE_ROOT="${CORTEX_REMOTE_ROOT:-/opt/clawdbot}"
REMOTE="${CORTEX_VM:-}"
DEPLOY=1
CHECK_ONLY=0

usage() {
  cat <<'USAGE'
Usage:
  CORTEX_VM=jake@10.0.0.52 ./scripts/deploy_to_cortex_vm.sh [--check-only] [--no-deploy] <path> [<path> ...]

What it does:
  - syncs the selected repo paths from the git-backed source tree to the Cortex VM
  - verifies the live container uses the canonical bind mount
  - optionally runs the remote deploy wrapper

Rules:
  - use this for path-scoped source-of-truth deploys
  - do NOT hotfix /app directly unless it is an emergency
  - if you emergency-patch live runtime, backport the same change here immediately

Examples:
  CORTEX_VM=jake@10.0.0.52 ./scripts/deploy_to_cortex_vm.sh cortex_server/cortex_server/routers/nexus.py
  CORTEX_VM=jake@10.0.0.52 ./scripts/deploy_to_cortex_vm.sh --no-deploy docs/DEPLOY.md scripts/deploy_to_cortex_vm.sh
  CORTEX_VM=jake@10.0.0.52 ./scripts/deploy_to_cortex_vm.sh --check-only
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-deploy)
      DEPLOY=0
      shift
      ;;
    --check-only)
      CHECK_ONLY=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --)
      shift
      break
      ;;
    -* )
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
    *)
      break
      ;;
  esac
done

if [[ -z "$REMOTE" ]]; then
  echo "Set CORTEX_VM, e.g. CORTEX_VM=jake@10.0.0.52" >&2
  exit 2
fi

cd "$ROOT"

verify_mount() {
  ssh -o BatchMode=yes -o StrictHostKeyChecking=no "$REMOTE" \
    "sudo docker inspect cortex-brain --format '{{range .Mounts}}{{println .Source \"->\" .Destination}}{{end}}' | grep -F '/opt/clawdbot/cortex_server/cortex_server -> /app/cortex_server' >/dev/null"
}

if (( CHECK_ONLY == 1 )); then
  verify_mount
  echo "[ok] canonical bind mount verified"
  exit 0
fi

if [[ $# -lt 1 ]]; then
  usage >&2
  exit 2
fi

paths=()
for rel in "$@"; do
  if [[ "$rel" = /* ]]; then
    echo "Absolute paths are not allowed: $rel" >&2
    exit 2
  fi
  if [[ "$rel" == *'..'* ]]; then
    echo "Parent path traversal is not allowed: $rel" >&2
    exit 2
  fi
  if [[ ! -e "$rel" ]]; then
    echo "Missing path: $rel" >&2
    exit 2
  fi
  paths+=("$rel")
done

echo "[sync] uploading ${#paths[@]} path(s) to $REMOTE:$REMOTE_ROOT"
tar -czf - "${paths[@]}" | ssh -o BatchMode=yes -o StrictHostKeyChecking=no "$REMOTE" \
  "mkdir -p '$REMOTE_ROOT' && tar -xzf - -C '$REMOTE_ROOT'"

verify_mount
echo "[ok] canonical bind mount verified"

if (( DEPLOY == 1 )); then
  echo "[deploy] running remote deploy wrapper"
  ssh -o BatchMode=yes -o StrictHostKeyChecking=no "$REMOTE" \
    "cd '$REMOTE_ROOT' && ./scripts/deploy_cortex.sh"
  echo "[done] remote deploy finished"
else
  echo "[done] sync complete (deploy skipped)"
fi
