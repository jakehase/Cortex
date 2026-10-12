"""
Meta Conductor router (L36): meta-orchestration and measured aggregate health.

* ``/health`` probes every registered level in-process (mount state from the
  running app, then the level's canonical status handler invoked through its
  route object) — no self-HTTP calls and no forwarded credentials.
* ``/status`` reports the cached aggregate health (never a constant
  "active"); a stale cache schedules a single background refresh.
* ``/orchestrate`` obtains the Nexus route plan by calling the Nexus handler
  with the *real* request (so the caller's authenticated principal is used)
  and an explicit ``payload=None``; it no longer passes ``request=None``.
"""

from datetime import datetime
import json
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from cortex_server.modules import cortex_kernel_v2, level_probe
from cortex_server.modules.health_status import (
    DEGRADED,
    DISABLED_BY_DESIGN,
    FAILED,
    OPERATIONAL,
    RESTRICTED_BY_DESIGN,
    STALE_EVIDENCE,
    UNTESTED,
    aggregate_status,
    is_failure,
    is_usable,
    normalize_status,
    vocabulary_payload,
)
from cortex_server.routers.nexus import orchestrate_query
from cortex_server.modules.level_registry import LEVEL_REGISTRY_VERSION, get_level_registry

router = APIRouter()

LEGACY_LEVELS: Dict[int, Dict[str, str]] = {
    int(row["level"]): {
        "name": str(row["name"]),
        "path": str(row["route_prefix"]),
        "status_path": str(row["canonical_status"]),
    }
    for row in get_level_registry()
    if int(row["level"]) in {33, 34, 35, 36, 37, 38}
}

# Kept for compatibility with importers; health now covers every level.
PROBE_LEVELS: Dict[int, Dict[str, str]] = {
    level: info for level, info in LEGACY_LEVELS.items() if level != 36
}

HEALTH_TTL_S = 30.0
HEALTH_STALE_AFTER_S = 300.0

CONTRACT_METADATA = {
    "contract_metadata_only": True,
    "activation_metadata_available": True,
    "activation_metadata_source": "meta_conductor",
}


class OrchestrateRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=16_384)
    target_levels: Optional[List[int]] = Field(default=None, max_length=38)
    timeout_seconds: float = Field(default=8.0, ge=1.0, le=30.0)


def _kernel_trace_payload(kernel_trace: Optional[Dict[str, Any]], *, kernel_result: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    if not isinstance(kernel_trace, dict):
        return {}
    payload = {
        "request_id": kernel_trace.get("request_id"),
        "runtime": kernel_trace.get("runtime"),
        "surface": kernel_trace.get("surface"),
        "plan": kernel_trace.get("plan") or {},
        "contract": kernel_trace.get("contract") or {},
        "working_set": kernel_trace.get("working_set") or {},
    }
    if isinstance(kernel_result, dict):
        payload["result"] = kernel_result.get("event") if kernel_result.get("recorded") else kernel_result
    return payload


def _extract_reported_level(body: Any) -> Optional[int]:
    if not isinstance(body, dict):
        return None
    lvl = body.get("level")
    if isinstance(lvl, int):
        return lvl
    data = body.get("data")
    if isinstance(data, dict) and isinstance(data.get("level"), int):
        return data.get("level")
    return None


def _status_levels() -> List[Dict[str, Any]]:
    levels = get_level_registry()
    by_level: Dict[int, Dict[str, Any]] = {}
    for item in levels:
        if isinstance(item, dict) and isinstance(item.get("level"), int):
            by_level[item["level"]] = dict(item)
    for lv, info in LEGACY_LEVELS.items():
        base = by_level.get(lv, {"level": lv})
        base["name"] = info["name"]
        base["path"] = info["path"]
        by_level[lv] = base
    return [by_level[k] for k in sorted(by_level.keys())]


def _self_tests() -> Dict[int, Dict[str, Any]]:
    """Cheap functional checks for levels that expose a pure self-test."""

    results: Dict[int, Dict[str, Any]] = {}
    try:
        from cortex_server.modules.validator import self_test

        results[34] = {"passed": bool(self_test().get("passed")), "check": "validator_known_good_and_bad_payloads"}
    except Exception as exc:
        results[34] = {"passed": False, "check": "validator_known_good_and_bad_payloads", "error": type(exc).__name__}
    try:
        from cortex_server.modules.kernel import collect_system_metrics

        metrics = collect_system_metrics()
        results[1] = {
            "passed": (metrics.get("memory") or {}).get("totalBytes") is not None,
            "check": "kernel_proc_meminfo_readable",
        }
    except Exception as exc:
        results[1] = {"passed": False, "check": "kernel_proc_meminfo_readable", "error": type(exc).__name__}
    return results


def _aggregate(snapshot: Optional[Dict[str, Any]], self_tests: Optional[Dict[int, Dict[str, Any]]] = None) -> Dict[str, Any]:
    if snapshot is None or not snapshot.get("available", True):
        return {"status": UNTESTED, "reason": (snapshot or {}).get("reason", "no_measurement"), "results": []}
    tests = self_tests or {}
    results: List[Dict[str, Any]] = []
    for row in snapshot.get("levels") or ():
        probe = row.get("probe") or {}
        test = tests.get(row["level"])
        state = normalize_status(row.get("status"))
        if test is not None and not test.get("passed") and state in {OPERATIONAL, RESTRICTED_BY_DESIGN}:
            state = DEGRADED
        results.append(
            {
                "level": row["level"],
                "name": row["name"],
                "path": row.get("route_prefix"),
                "status_path": row.get("canonical_status"),
                "mounted": row.get("mount") in {"full", "mounted", "safe_subset"},
                "mount": row.get("mount"),
                "state": state,
                "reason": row.get("reason"),
                "http_status": probe.get("status_code"),
                "probe_outcome": probe.get("outcome"),
                "reported_level": probe.get("reported_level"),
                "identity_match": (
                    probe.get("reported_level") == row["level"] if probe.get("reported_level") is not None else None
                ),
                "reported_status": probe.get("reported_status"),
                "latency_ms": probe.get("latency_ms"),
                "self_test": test,
                "success": is_usable(state),
            }
        )
    evaluated = [
        r for r in results
        if r["state"] not in {DISABLED_BY_DESIGN, UNTESTED}
    ]
    usable = [r for r in evaluated if r["success"]]
    status = aggregate_status(r["state"] for r in results)
    return {
        "status": status,
        "health_pct": round(100.0 * len(usable) / len(evaluated), 1) if evaluated else None,
        "failed_levels": [r["level"] for r in results if r["state"] == FAILED],
        "degraded_levels": [r["level"] for r in results if r["state"] == DEGRADED],
        "restricted_by_design_levels": [
            r["level"] for r in results if r["state"] == RESTRICTED_BY_DESIGN
        ],
        "disabled_by_design_levels": [
            r["level"] for r in results if r["state"] == DISABLED_BY_DESIGN
        ],
        "stale_evidence_levels": [
            r["level"] for r in results if r["state"] == STALE_EVIDENCE
        ],
        "untested_levels": [r["level"] for r in results if r["state"] == UNTESTED],
        "unmounted_levels": [
            r["level"] for r in results
            if r["state"] in {DISABLED_BY_DESIGN, UNTESTED}
        ],
        "identity_mismatch_levels": [r["level"] for r in results if r["identity_match"] is False],
        "timeout_levels": [r["level"] for r in results if r["probe_outcome"] == "timeout"],
        "levels_probed": sum(1 for r in results if r["http_status"] is not None),
        "results": results,
    }


@router.get("/health")
async def meta_conductor_health(http_request: Request, refresh: bool = False) -> Dict[str, Any]:
    level_probe.remember_app(http_request.app)
    snapshot = await level_probe.refresh_probe_snapshot(
        http_request.app, max_age_s=0.0 if refresh else HEALTH_TTL_S
    )
    aggregate = _aggregate(snapshot, _self_tests())
    return {
        "success": not is_failure(aggregate["status"]),
        "service": "meta_conductor",
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "measured_at": (snapshot or {}).get("measured_at"),
        "snapshot_age_s": (snapshot or {}).get("age_s"),
        "probe_mode": "in_process_route_handler",
        "activation_metadata_source": "meta_conductor",
        "status_vocabulary": vocabulary_payload(),
        **aggregate,
        "kernel_v2": cortex_kernel_v2.performance_snapshot(runtime="meta_conductor"),
        "contract": dict(CONTRACT_METADATA),
    }


@router.get("/status")
async def meta_conductor_status(http_request: Request) -> Dict[str, Any]:
    level_probe.remember_app(http_request.app)
    snapshot = level_probe.cached_probe_snapshot(None)
    level_probe.schedule_probe_refresh(http_request.app, max_age_s=HEALTH_TTL_S)
    age = (snapshot or {}).get("age_s")
    if snapshot is None and level_probe.refresh_in_progress():
        aggregate: Dict[str, Any] = {"status": UNTESTED, "failed_levels": [], "unmounted_levels": []}
    elif snapshot is not None and age is not None and age > HEALTH_STALE_AFTER_S:
        aggregate = _aggregate(snapshot)
        aggregate = {
            **aggregate,
            "status": aggregate_status([aggregate["status"], STALE_EVIDENCE]),
        }
    else:
        aggregate = _aggregate(snapshot)
    levels = _status_levels()
    return {
        "success": not is_failure(aggregate["status"]),
        "level": 36,
        "name": "Conductor (Meta)",
        "status": aggregate["status"],
        "status_basis": "cached in-process aggregate health of all registered levels",
        "health_snapshot_age_s": age,
        "health_pct": aggregate.get("health_pct"),
        "failed_levels": aggregate.get("failed_levels", []),
        "degraded_levels": aggregate.get("degraded_levels", []),
        "restricted_by_design_levels": aggregate.get("restricted_by_design_levels", []),
        "disabled_by_design_levels": aggregate.get("disabled_by_design_levels", []),
        "stale_evidence_levels": aggregate.get("stale_evidence_levels", []),
        "untested_levels": aggregate.get("untested_levels", []),
        "unmounted_levels": aggregate.get("unmounted_levels", []),
        "total_levels": len(levels),
        "levels": levels,
        "activation_metadata_available": True,
        "activation_metadata_source": "meta_conductor",
        "status_vocabulary": vocabulary_payload(),
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "kernel_v2": cortex_kernel_v2.performance_snapshot(runtime="meta_conductor"),
        "contract": dict(CONTRACT_METADATA),
    }


@router.get("/kernel/status")
async def meta_conductor_kernel_status() -> Dict[str, Any]:
    return {"success": True, **cortex_kernel_v2.performance_snapshot(runtime="meta_conductor")}


@router.get("/kernel/telemetry")
async def meta_conductor_kernel_telemetry(limit: int = 25) -> Dict[str, Any]:
    return {"success": True, **cortex_kernel_v2.diagnostic_bundle(runtime="meta_conductor", limit=limit)}


def _plan_dict(data: Any) -> Dict[str, Any]:
    if isinstance(data, dict):
        return data
    if hasattr(data, "model_dump"):
        return data.model_dump()
    body = getattr(data, "body", None)
    if isinstance(body, (bytes, bytearray)):
        try:
            parsed = json.loads(bytes(body).decode("utf-8"))
            if isinstance(parsed, dict):
                return parsed
        except (ValueError, UnicodeDecodeError):
            pass
    raise ValueError("Nexus returned an unrecognised plan shape")


async def _probe_targets(app: Any, levels: List[int], timeout_seconds: float) -> List[Dict[str, Any]]:
    if not levels:
        return []
    snapshot = await level_probe.probe_levels(app, levels=levels, timeout_s=timeout_seconds)
    return _aggregate(snapshot).get("results", [])


@router.post("/orchestrate")
async def meta_conductor_orchestrate(req: OrchestrateRequest, http_request: Request) -> Dict[str, Any]:
    if not req.query.strip():
        raise HTTPException(status_code=422, detail="query is required")
    target_levels = req.target_levels if req.target_levels else [33, 34, 35]
    if any(isinstance(lvl, bool) or not 1 <= int(lvl) <= 38 for lvl in target_levels):
        raise HTTPException(status_code=422, detail="target_levels must be level numbers 1..38")
    kernel_trace = cortex_kernel_v2.prepare_request(
        req.query,
        response_mode="meta_conductor_orchestrate",
        requested_model="meta_conductor",
        runtime="meta_conductor",
        surface="orchestrate",
    )
    try:
        # Call the Nexus handler with the real request so its principal
        # authentication runs on the caller's credentials, and pass payload
        # explicitly (the route-level Body() default is not a value).
        raw = await orchestrate_query(query=req.query, request=http_request, codec_probe=False, payload=None)
        data = _plan_dict(raw)
    except HTTPException as exc:
        cortex_kernel_v2.finalize_request(
            kernel_trace.get("request_id"),
            response="",
            actual_lane="meta_conductor_orchestrated",
            used_backend="delegated_nexus",
            fallback_reason=f"nexus_http_{exc.status_code}",
            contract_ok=False,
            error=f"HTTPException:{exc.status_code}",
        )
        raise
    except Exception as e:
        cortex_kernel_v2.finalize_request(
            kernel_trace.get("request_id"),
            response="",
            actual_lane="meta_conductor_orchestrated",
            used_backend="delegated_nexus",
            fallback_reason="delegation_failed",
            contract_ok=False,
            error=f"{type(e).__name__}",
        )
        raise HTTPException(status_code=502, detail=f"Nexus delegation failed: {type(e).__name__}")

    contract = data.get("contract") if isinstance(data.get("contract"), dict) else {}
    contract = dict(contract)
    contract.update(CONTRACT_METADATA)
    contract["kernel_contract_version"] = (kernel_trace.get("contract") or {}).get("version")
    contract["kernel_lane"] = (kernel_trace.get("plan") or {}).get("lane")

    results = await _probe_targets(http_request.app, [int(lvl) for lvl in target_levels], req.timeout_seconds)

    kernel_result = cortex_kernel_v2.finalize_request(
        kernel_trace.get("request_id"),
        response=str(data.get("routing_method") or data.get("semantic_analysis") or "delegated_nexus"),
        actual_lane="meta_conductor_orchestrated",
        used_backend=str(data.get("routing_method") or "delegated_nexus"),
        contract_ok=True,
    )

    return {
        "success": True,
        "query": req.query,
        "routing_method": data.get("routing_method", "delegated_nexus"),
        "recommended_levels": data.get("recommended_levels", []),
        "semantic_analysis": data.get("semantic_analysis", {}),
        "results": results,
        "levels_queried": len(results),
        "target_levels_probe_mode": "in_process_route_handler",
        "delegated_from": "nexus",
        "contract": contract,
        "contract_version": contract.get("contract_version") or data.get("contract_version") or "orchestrate_guard_v2",
        "kernel_v2": _kernel_trace_payload(kernel_trace, kernel_result=kernel_result),
        "timestamp": datetime.utcnow().isoformat() + "Z",
    }


@router.get("/endpoint_map")
async def endpoint_map() -> Dict[str, Any]:
    levels = get_level_registry()
    return {
        "success": True,
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "registry_version": LEVEL_REGISTRY_VERSION,
        "contract": {**CONTRACT_METADATA, "contract_version": "cortex.contract.v1"},
        "levels": levels,
    }
