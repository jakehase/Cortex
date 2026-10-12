"""Catalyst Router - L11 measured performance profiling and bottleneck analysis.

All numbers come from the running process (observability ring, /proc,
event-loop timing, offload and breaker state). Catalyst never accepts a
caller-supplied duration as a "profile" and never claims to have optimized
anything; the former ``optimize_now``/``toggle_auto_optimize`` endpoints are
kept as explicit 501 "not implemented" responses.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from cortex_server.modules import catalyst as catalyst_core
from cortex_server.modules import level_probe

router = APIRouter()


class ProfileRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    route: str = Field(..., min_length=1, max_length=512)
    window_s: Optional[float] = Field(default=None, gt=0, le=86400)


class AnalyzeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    focus: Optional[str] = Field(default=None, max_length=512)
    narrate: bool = False


class CatalystNarrative(BaseModel):
    model_config = ConfigDict(extra="forbid")
    likely_causes: List[str] = Field(default_factory=list, max_length=5)
    next_steps: List[str] = Field(default_factory=list, max_length=5)


async def _capabilities() -> Dict[str, bool]:
    caps: Dict[str, bool] = {}
    try:
        from cortex_server.modules import metrics_store  # noqa: F401

        caps["route_latency_profiling"] = True
    except Exception:
        caps["route_latency_profiling"] = False
    try:
        from cortex_server.modules.kernel import get_kernel

        status = await asyncio.to_thread(get_kernel().status)
        caps["host_metrics"] = status.get("metricsAvailable") is True
    except Exception:
        caps["host_metrics"] = False
    caps["event_loop_lag"] = True
    caps["offload_saturation"] = catalyst_core._offload_status() is not None
    caps["dependency_breaker_state"] = catalyst_core._dependency_state() is not None
    caps["bottleneck_rules"] = True
    return caps


@router.get("/status")
async def catalyst_status(request: Request):
    """L11: measured status; capabilities reflect what is importable/readable."""

    level_probe.remember_app(request.app)
    caps = await _capabilities()
    samples = sum(row["count"] for row in catalyst_core.route_statistics().values())
    working = caps["route_latency_profiling"] and caps["host_metrics"]
    return {
        "success": working,
        "level": 11,
        "name": "Catalyst",
        "status": "active" if working else "degraded",
        "capabilities": sorted(name for name, ok in caps.items() if ok),
        "capability_checks": caps,
        "not_implemented": ["automatic_optimization"],
        "observed_request_samples": samples,
        "sample_window": "since_boot_bounded_ring",
        "counters_since_boot": catalyst_core.counters(),
        "thresholds": catalyst_core.thresholds(),
    }


@router.get("/snapshot")
async def catalyst_snapshot():
    """Measured host/process/route/offload snapshot."""

    return {"success": True, **(await catalyst_core.snapshot())}


@router.post("/profile")
async def profile_endpoint(
    request: Request,
    body: Optional[ProfileRequest] = Body(default=None),
    endpoint: Optional[str] = None,
    route: Optional[str] = None,
    window_s: Optional[float] = None,
    duration_ms: Optional[float] = None,
):
    """Measured statistics for one route template (never caller-supplied numbers)."""

    if duration_ms is not None:
        raise HTTPException(
            status_code=422,
            detail="caller-supplied durations are not accepted; Catalyst measures routes itself",
        )
    target = (body.route if body is not None else None) or route or endpoint
    window = (body.window_s if body is not None else None) or window_s
    if not target or not str(target).strip():
        raise HTTPException(status_code=422, detail="route is required")
    target = str(target).strip()[:512]
    if window is not None and not 0 < float(window) <= 86400:
        raise HTTPException(status_code=422, detail="window_s must be in (0, 86400]")
    result = catalyst_core.profile_route(target, window_s=window)
    if not result["measured"]:
        mounted = any(path == target for _method, path in level_probe.mounted_route_keys(request.app))
        if not mounted:
            raise HTTPException(status_code=404, detail="route is not mounted and has no observed samples")
    return {"success": True, "profiled": result["measured"], **result}


@router.post("/analyze")
async def analyze_endpoint(request: Request, body: Optional[AnalyzeRequest] = Body(default=None)):
    """Deterministic bottleneck analysis with optional model narration (labelled)."""

    req = body or AnalyzeRequest()
    analysis = await catalyst_core.analyze(req.focus)
    narrative: Dict[str, Any] = {"narrative_source": "none"}
    if req.narrate and analysis["bottlenecks"]:
        from cortex_server.modules.level_model import level_model_json, scope_key_for_request

        prompt = (
            "Measured Cortex performance findings (JSON). Use ONLY these numbers; do not invent metrics.\n"
            + json.dumps(
                {
                    "bottlenecks": analysis["bottlenecks"],
                    "top_routes": analysis["top_routes"],
                    "host": analysis["host"],
                    "event_loop_lag_ms": analysis["event_loop_lag_ms"],
                },
                default=str,
            )[:12000]
            + '\nReturn JSON {"likely_causes": [<=5 short strings], "next_steps": [<=5 concrete actions]}.'
        )
        result = await level_model_json(
            level=11,
            name="catalyst",
            system=(
                "You are a performance engineer. Given only the supplied measurements, list the most likely "
                "causes of each bottleneck and concrete, reversible next steps. Output JSON only."
            ),
            prompt=prompt,
            principal_scope_key=scope_key_for_request(request, "catalyst"),
            schema=CatalystNarrative,
            deadline_s=45.0,
        )
        if result.get("ok"):
            narrative = {
                "narrative_source": "model",
                "narrative": result.get("data"),
                "model": result.get("model"),
                "receipt_id": result.get("receipt_id"),
                "label": "MODEL ADVICE FROM MEASURED FINDINGS — NOTHING WAS CHANGED",
            }
        else:
            narrative = {"narrative_source": "none", "narrative_status": result.get("status"),
                         "label": result.get("label")}
    elif req.narrate:
        narrative = {"narrative_source": "none", "narrative_status": "no_bottlenecks_to_explain"}
    return {"success": True, **analysis, **narrative}


def _not_implemented(operation: str) -> HTTPException:
    return HTTPException(
        status_code=501,
        detail={
            "implemented": False,
            "operation": operation,
            "reason": "Catalyst measures and advises; it does not apply runtime optimizations",
            "use_instead": "POST /catalyst/analyze",
        },
    )


@router.post("/optimize_now")
async def optimize_now():
    """Not implemented: no optimization is performed (previously only a counter)."""

    raise _not_implemented("optimize_now")


@router.post("/toggle_auto_optimize")
async def toggle_auto_optimize(enable: bool = True):
    """Not implemented: there is no automatic optimization to toggle."""

    raise _not_implemented("toggle_auto_optimize")
