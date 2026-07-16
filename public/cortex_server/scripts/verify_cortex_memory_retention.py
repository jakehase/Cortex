#!/usr/bin/env python3
"""Bounded semantic-search memory retention verifier.

Run this in a fresh process so glibc reads MALLOC_* before Python starts:

  MALLOC_ARENA_MAX=2 MALLOC_TRIM_THRESHOLD_=131072 \
    python3 scripts/verify_cortex_memory_retention.py --calls 30

The verifier is intentionally separate from unit tests because it loads the
real Chroma collection and ONNX model. It emits machine-readable JSON and exits
non-zero when retained RSS or 64 MiB glibc arena mappings exceed the guard.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys
import time
from typing import Any, Dict, List

SERVER_ROOT = Path(__file__).resolve().parents[1]
if str(SERVER_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVER_ROOT))


def _status_values() -> Dict[str, int]:
    values: Dict[str, int] = {}
    wanted = {"VmRSS", "VmHWM", "RssAnon", "RssFile", "VmSize", "VmSwap", "Threads"}
    with open("/proc/self/status", "r", encoding="utf-8") as handle:
        for line in handle:
            key = line.split(":", 1)[0]
            if key not in wanted:
                continue
            parts = line.split()
            values[key] = int(parts[1]) if len(parts) > 1 else 0
    return values


def _large_anonymous_maps(minimum_kib: int = 60_000) -> List[int]:
    maps: List[int] = []
    with open("/proc/self/smaps", "r", encoding="utf-8") as handle:
        for line in handle:
            if not line.startswith("Anonymous:"):
                continue
            kib = int(line.split()[1])
            if kib >= minimum_kib:
                maps.append(kib)
    return maps


def _snapshot() -> Dict[str, Any]:
    status = _status_values()
    large_maps = _large_anonymous_maps()
    return {
        "rssMiB": round(status.get("VmRSS", 0) / 1024, 3),
        "highWaterMiB": round(status.get("VmHWM", 0) / 1024, 3),
        "anonymousMiB": round(status.get("RssAnon", 0) / 1024, 3),
        "virtualMiB": round(status.get("VmSize", 0) / 1024, 3),
        "swapMiB": round(status.get("VmSwap", 0) / 1024, 3),
        "threads": status.get("Threads", 0),
        "largeAnonymousMapCount": len(large_maps),
        "largeAnonymousMapMiB": round(sum(large_maps) / 1024, 3),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--calls", type=int, default=30)
    parser.add_argument("--max-retained-rss-mib", type=float, default=512.0)
    parser.add_argument("--max-large-anon-maps", type=int, default=1)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    from cortex_server.modules import runtime_pressure
    from cortex_server.routers.librarian import robust_search

    before = _snapshot()
    latencies: List[float] = []
    modes: Dict[str, int] = {}
    for index in range(max(1, int(args.calls))):
        started = time.perf_counter()
        result = robust_search(
            f"cortex allocator retention verifier call {index:04d} native semantic recall",
            n_results=1 + (index % 7),
            allow_fallback=True,
        )
        latencies.append(time.perf_counter() - started)
        mode = str(result.get("search_mode") or "unknown")
        modes[mode] = modes.get(mode, 0) + 1

    after = _snapshot()
    runtime = runtime_pressure.pressure_snapshot()
    failures = []
    if after["rssMiB"] > float(args.max_retained_rss_mib):
        failures.append("retained_rss_exceeded")
    if after["largeAnonymousMapCount"] > int(args.max_large_anon_maps):
        failures.append("large_anonymous_arena_count_exceeded")
    if int((runtime.get("counters") or {}).get("onnx_session_inits") or 0) != 1:
        failures.append("onnx_session_count_not_one")

    report = {
        "schemaVersion": "cortex.native-memory-retention.v1",
        "passed": not failures,
        "failures": failures,
        "configuration": {
            "mallocArenaMax": os.getenv("MALLOC_ARENA_MAX"),
            "mallocTrimThreshold": os.getenv("MALLOC_TRIM_THRESHOLD_"),
            "mallocTopPad": os.getenv("MALLOC_TOP_PAD_"),
            "calls": max(1, int(args.calls)),
            "maxRetainedRssMiB": float(args.max_retained_rss_mib),
            "maxLargeAnonymousMaps": int(args.max_large_anon_maps),
        },
        "before": before,
        "after": after,
        "deltaRssMiB": round(after["rssMiB"] - before["rssMiB"], 3),
        "latencySeconds": {
            "min": round(min(latencies), 4),
            "max": round(max(latencies), 4),
            "mean": round(sum(latencies) / len(latencies), 4),
        },
        "searchModes": modes,
        "embeddingRuntime": runtime,
    }
    encoded = json.dumps(report, indent=2, sort_keys=True)
    print(encoded)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(encoded + "\n", encoding="utf-8")
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
