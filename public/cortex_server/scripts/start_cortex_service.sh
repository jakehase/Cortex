#!/usr/bin/env bash
set -euo pipefail

cd /root/clawd/public/cortex_server
export PYTHONUNBUFFERED=1
export CORTEX_HOST="${CORTEX_HOST:-0.0.0.0}"
export CORTEX_PORT="${CORTEX_PORT:-8000}"

exec /usr/bin/python3 -m uvicorn cortex_server.main:app \
  --host "${CORTEX_HOST}" \
  --port "${CORTEX_PORT}"
