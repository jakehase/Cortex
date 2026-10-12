"""L21 Sentinel adapter: read-only watcher and scan health (no probes sent)."""

from __future__ import annotations

from typing import Any, Dict, Mapping

from cortex_server.modules.execution_engine import ExecutionBlocked

LEVEL = 21
NAME = "sentinel"
NEEDS_MODEL = False
SAFE_AUTORUN = True
DEFAULT_DEADLINE_S = 1.0


async def run(query: str, context: Mapping[str, Any]) -> Dict[str, Any]:
    from cortex_server.routers import sentinel

    try:
        health = sentinel._sentinel_health_snapshot()
        persistence = sentinel.watcher_state_health()
        watchers = sentinel._watcher_summaries()
    except Exception as exc:
        raise ExecutionBlocked("sentinel_state_unavailable") from exc

    failing = [
        {"watch_id": row["watch_id"], "status_code": (row.get("last_result") or {}).get("status_code"),
         "error": (row.get("last_result") or {}).get("error")}
        for row in watchers
        if (row.get("last_result") or {}).get("ok") is False
    ][:20]
    unchecked = sum(1 for row in watchers if row.get("last_result") is None)
    sw = health.get("self_watch") or {}
    if sw.get("fresh"):
        issues = sw.get("issues") or []
        self_watch_text = (
            f"Self-watch (read-only, every {int(sw.get('interval_s') or 0)} s; last {sw.get('last_age_s')} s ago): "
            + ("all checks passed. " if not issues else
               "; ".join(f"[{i['severity']}] {i['check']}: {i['detail']}" for i in issues[:6]) + ". ")
        )
    else:
        self_watch_text = f"Self-watch: {sw.get('status') or 'off'} (no fresh sweep yet). "
    summary = (
        f"Sentinel health: {health.get('status')} ({health.get('health_reason')}). "
        + self_watch_text
        + f"{len(watchers)} endpoint watcher(s) configured, {len(failing)} failing on last check, "
        f"{unchecked} not yet checked since boot. "
        f"Watcher persistence: {persistence.get('status')}. "
        "Sentinel monitors and reports only; it does not perform security scanning or self-healing."
    )
    return {
        "operation": "sentinel.health",
        "origin": "deterministic",
        "summary": summary[:1500],
        "data": {
            "status": health.get("status"),
            "severity": health.get("severity"),
            "health_reason": health.get("health_reason"),
            "last_scan_age_s": health.get("last_scan_age_seconds"),
            "latest_scan_issues": health.get("latest_scan_issues"),
            "watchers": len(watchers),
            "failing": failing,
            "persistence": persistence.get("status"),
            "self_watch": {k: sw.get(k) for k in ("status", "fresh", "last_age_s", "interval_s", "issues", "checks")},
        },
    }
