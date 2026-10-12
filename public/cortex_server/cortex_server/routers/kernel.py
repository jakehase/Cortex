"""Level 1 Kernel endpoints: measured telemetry and measured level availability."""

import asyncio
from datetime import datetime
from typing import Any, Dict, List

from fastapi import APIRouter, Request

from cortex_server.modules import level_probe
from cortex_server.modules.health_status import OPERATIONAL, vocabulary_payload
from cortex_server.modules.level_registry import LEVEL_REGISTRY_VERSION, get_level_entry
from cortex_server.modules.kernel import get_kernel, kernel_level_status

router = APIRouter()


def _default_levels(app: Any = None) -> List[Dict[str, Any]]:
    """Per-level rows derived from the running app (kept for compatibility)."""

    return kernel_level_status(app)["levels"]


@router.get("/levels")
async def kernel_levels(request: Request, probe: bool = False) -> Dict[str, Any]:
    """Measured level availability.

    Status comes from the mounted route table, the router load report, the
    recent-response ring and (when fresh, or when ``probe=true``) in-process
    probes of each level's canonical status handler. No level is reported
    ``operational`` unless its router is loaded and its status route is mounted.
    """

    app = request.app
    level_probe.remember_app(app)
    snapshot = None
    if probe:
        snapshot = await level_probe.refresh_probe_snapshot(app, max_age_s=10.0)
    status = kernel_level_status(app, probe_snapshot=snapshot)
    return {
        "success": bool(status.get("measured")),
        "registry_version": LEVEL_REGISTRY_VERSION,
        "measured": status.get("measured"),
        "sources": status.get("sources"),
        "probe_snapshot_age_s": status.get("probe_snapshot_age_s"),
        "counts": status.get("counts"),
        "status": status.get("status"),
        "status_vocabulary": vocabulary_payload(),
        "probe_evidence_status": status.get("probe_evidence_status"),
        "operational_levels": status.get("operational_levels"),
        "restricted_by_design_levels": status.get("restricted_by_design_levels"),
        "disabled_by_design_levels": status.get("disabled_by_design_levels"),
        "stale_evidence_levels": status.get("stale_evidence_levels"),
        "online_levels": status.get("online_levels"),
        "restricted_levels": status.get("restricted_levels"),
        "degraded_levels": status.get("degraded_levels"),
        "unavailable_levels": status.get("unavailable_levels"),
        "levels": status.get("levels"),
        "timestamp": datetime.utcnow().isoformat() + "Z",
    }


@router.get("/status")
async def kernel_status(request: Request) -> Dict[str, Any]:
    level_probe.remember_app(request.app)
    entry = get_level_entry(1) or {"level": 1, "name": "Kernel", "canonical_status": "/kernel/status"}
    observed = await asyncio.to_thread(get_kernel().status)
    return {
        "success": observed["status"] == OPERATIONAL,
        "level": entry["level"],
        "name": entry["name"],
        "status": observed["status"],
        "status_vocabulary": vocabulary_payload(),
        "metrics_available": observed["metricsAvailable"],
        "process_alive": observed["processAlive"],
        "control_available": observed["controlAvailable"],
        "missing_sources": observed.get("missingSources", []),
        "error_type": observed.get("errorType"),
        "canonical_status": entry["canonical_status"],
        "registry_version": LEVEL_REGISTRY_VERSION,
        "timestamp": datetime.utcnow().isoformat() + "Z",
    }


@router.get("/metrics")
async def kernel_metrics(request: Request) -> Dict[str, Any]:
    """Return bounded numeric host/process telemetry; perform no mutation."""

    level_probe.remember_app(request.app)
    metrics = await asyncio.to_thread(get_kernel().metrics)
    return {
        "success": True,
        "level": 1,
        "metrics": metrics,
        "timestamp": datetime.utcnow().isoformat() + "Z",
    }
