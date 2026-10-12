"""L11 Catalyst adapter: measured bottleneck analysis of the running process."""

from __future__ import annotations

import re
from typing import Any, Dict, Mapping, Optional

from cortex_server.modules.execution_engine import ExecutionBlocked

LEVEL = 11
NAME = "catalyst"
NEEDS_MODEL = False
SAFE_AUTORUN = True
DEFAULT_DEADLINE_S = 3.0

_ROUTE_RE = re.compile(r"(?<![\w.])(/[a-z0-9_]+(?:/[a-z0-9_{}.-]+)*)")


def _focus_route(query: str, context: Mapping[str, Any]) -> Optional[str]:
    explicit = context.get("focus_route") if isinstance(context, Mapping) else None
    if isinstance(explicit, str) and explicit.startswith("/"):
        return explicit[:512]
    match = _ROUTE_RE.search(str(query or "").lower())
    return match.group(1)[:512] if match else None


async def run(query: str, context: Mapping[str, Any]) -> Dict[str, Any]:
    from cortex_server.modules import catalyst

    focus = _focus_route(query, context)
    try:
        analysis = await catalyst.analyze(None)
    except Exception as exc:
        raise ExecutionBlocked("catalyst_measurement_failed") from exc

    focus_stats = catalyst.profile_route(focus) if focus else None
    findings = analysis["bottlenecks"][:5]
    host = analysis.get("host") or {}
    cpu = host.get("cpu") or {}
    mem = host.get("mem") or {}
    lines = [
        f"Measured over {analysis['samples']} recent requests (since boot, bounded ring); "
        f"event-loop lag {analysis['event_loop_lag_ms']} ms; cpu {cpu.get('util_pct')}%; "
        f"memory available {mem.get('avail_pct')}%."
    ]
    if findings:
        for finding in findings:
            where = finding.get("route") or finding.get("dependency") or finding.get("mount") or ""
            lines.append(
                f"[{finding['severity']}] {finding['rule']} {where} value={finding['value']} threshold={finding['threshold']}".strip()
            )
    else:
        lines.append("No bottleneck rule fired.")
    if focus_stats is not None:
        if focus_stats["measured"]:
            lines.append(
                f"Route {focus}: n={focus_stats['count']} p50={focus_stats['p50_ms']}ms "
                f"p95={focus_stats['p95_ms']}ms error_rate={focus_stats['error_rate']}"
            )
        else:
            lines.append(f"Route {focus}: no observed requests in the ring.")
    lines.append("Nothing was optimized; these are measurements only.")
    return {
        "operation": "catalyst.analyze",
        "origin": "deterministic",
        "summary": " ".join(lines)[:1500],
        "data": {
            "measured_at": analysis["measured_at"],
            "samples": analysis["samples"],
            "host": host,
            "event_loop_lag_ms": analysis["event_loop_lag_ms"],
            "bottlenecks": findings,
            "top_routes": [
                {k: row.get(k) for k in ("route", "count", "p95_ms", "error_rate")}
                for row in analysis["top_routes"][:5]
            ],
            "focus_route": focus_stats,
        },
    }
