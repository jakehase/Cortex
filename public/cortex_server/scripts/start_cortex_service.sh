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

exec /usr/bin/python3 -m uvicorn cortex_server.main:app \
  --host "${CORTEX_HOST}" \
  --port "${CORTEX_PORT}"
