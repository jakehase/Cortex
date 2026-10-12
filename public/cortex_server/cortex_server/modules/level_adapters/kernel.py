"""L1 Kernel adapter: measured host telemetry plus measured level availability."""

from __future__ import annotations

import asyncio
from typing import Any, Dict, Mapping

from cortex_server.modules.execution_engine import ExecutionBlocked

LEVEL = 1
NAME = "kernel"
NEEDS_MODEL = False
SAFE_AUTORUN = True
DEFAULT_DEADLINE_S = 2.0


async def run(query: str, context: Mapping[str, Any]) -> Dict[str, Any]:
    from cortex_server.modules.kernel import get_kernel, kernel_level_status, summarise_metrics

    try:
        metrics = await asyncio.to_thread(get_kernel().metrics)
    except Exception as exc:
        raise ExecutionBlocked("kernel_metrics_unavailable") from exc
    digest = summarise_metrics(metrics)
    levels = kernel_level_status(context.get("app") if isinstance(context, Mapping) else None)
    level_summary: Dict[str, Any] = {"measured": bool(levels.get("measured"))}
    if levels.get("measured"):
        level_summary.update(
            online=len(levels["online_levels"]),
            restricted=levels["restricted_levels"],
            degraded=levels["degraded_levels"],
            unavailable=levels["unavailable_levels"],
        )

    cpu = digest["cpu"]
    mem = digest["mem"]
    parts = [
        f"load1={cpu['load1']}" if cpu["load1"] is not None else "load1=unavailable",
        (
            f"cpu={cpu['util_pct']}%"
            + (f" (over {cpu['sample_window_s']}s, {cpu.get('logical') or '?'} logical CPUs)" if cpu.get("sample_window_s") else "")
        )
        if cpu["util_pct"] is not None
        else "cpu=unavailable",
        f"mem_available={mem['avail_pct']}%" if mem["avail_pct"] is not None else "mem=unavailable",
    ]
    for disk in digest["disk"][:2]:
        parts.append(f"disk {disk['mount']} used={disk['used_pct']}%")
    if level_summary["measured"]:
        parts.append(
            f"levels online={level_summary['online']}, restricted={len(level_summary['restricted'])}, "
            f"degraded={level_summary['degraded'] or 'none'}, unavailable={level_summary['unavailable'] or 'none'}"
        )
    else:
        parts.append("level availability could not be measured (no running app)")
    return {
        "operation": "kernel.snapshot",
        "origin": "deterministic",
        "summary": ("Measured Cortex host/process state: " + "; ".join(parts))[:1500],
        "data": {**digest, "levels": level_summary},
    }
