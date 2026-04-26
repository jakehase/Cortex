"""
Meta Conductor compatibility router.
Provides consistent orchestration contract metadata and delegates routing to Nexus.
Adds legacy status/health fields expected by watchdogs.
"""

from datetime import datetime
from typing import Any, Dict, List, Optional
import asyncio
import os
import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from cortex_server.modules import cortex_kernel_v2
from cortex_server.routers.nexus import orchestrate_query
from cortex_server.modules.level_registry import LEVEL_REGISTRY_VERSION, get_level_registry

router = APIRouter()

LEGACY_LEVELS: Dict[int, Dict[str, str]] = {
    33: {"name": "Ethicist", "path": "/ethicist", "status_path": "/ethicist/status"},
    34: {"name": "Validator", "path": "/validator", "status_path": "/validator/status"},
    35: {"name": "Singularity", "path": "/singularity", "status_path": "/singularity/status"},
    36: {"name": "Conductor (Meta)", "path": "/meta_conductor", "status_path": "/meta_conductor/status"},
    37: {"name": "Awareness", "path": "/awareness", "status_path": "/awareness/status"},
    38: {"name": "Augmenter", "path": "/augmenter", "status_path": "/augmenter/status"},
}

# Probes we can safely call without recursive self-status loops.
PROBE_LEVELS: Dict[int, Dict[str, str]] = {
    33: LEGACY_LEVELS[33],
    34: LEGACY_LEVELS[34],
    35: LEGACY_LEVELS[35],
    37: LEGACY_LEVELS[37],
    38: LEGACY_LEVELS[38],
}


class OrchestrateRequest(BaseModel):
    query: str
    target_levels: Optional[List[int]] = None
    timeout_seconds: float = 8.0


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
    if isinstance(levels, list):
        for item in levels:
            if not isinstance(item, dict):
                continue
            lv = item.get("level")
            if isinstance(lv, int):
                by_level[lv] = dict(item)

    for lv, info in LEGACY_LEVELS.items():
        base = by_level.get(lv, {"level": lv})
        base["name"] = info["name"]
        base["path"] = info["path"]
        by_level[lv] = base

    return [by_level[k] for k in sorted(by_level.keys())]


async def _probe_level(client: httpx.AsyncClient, level: int, timeout_seconds: float) -> Dict[str, Any]:
    info = PROBE_LEVELS[level]
    started = datetime.utcnow()
    base_urls = [
        base.strip().rstrip("/")
        for base in str(os.getenv("CORTEX_META_PROBE_BASES", "http://127.0.0.1:8000,http://127.0.0.1:8888")).split(",")
        if base.strip()
    ]
    status_path = str(info.get("status_path") or f"{info['path'].rstrip('/')}/status")
    path_candidates: List[str] = []
    for candidate in [status_path, str(info["path"] or "")]:
        normalized = candidate if candidate.startswith("/") else f"/{candidate}"
        if normalized and normalized not in path_candidates:
            path_candidates.append(normalized)

    errors: List[str] = []
    for base_url in base_urls:
        for candidate_path in path_candidates:
            url = f"{base_url}{candidate_path}"
            try:
                resp = await client.get(url, timeout=max(1.0, float(timeout_seconds)))
                latency_ms = round((datetime.utcnow() - started).total_seconds() * 1000, 2)
                if resp.status_code != 200:
                    errors.append(f"{url} -> HTTP {resp.status_code}")
                    continue
                body = resp.json()
                reported_level = _extract_reported_level(body)
                identity_match = (reported_level == level) if reported_level is not None else None
                return {
                    "level": level,
                    "name": info["name"],
                    "path": info["path"],
                    "status_path": status_path,
                    "probed_url": url,
                    "success": bool(identity_match is not False),
                    "data": body,
                    "error": None,
                    "latency_ms": latency_ms,
                    "reported_level": reported_level,
                    "identity_match": identity_match,
                }
            except Exception as e:
                errors.append(f"{url} -> {str(e)}")

    latency_ms = round((datetime.utcnow() - started).total_seconds() * 1000, 2)
    return {
        "level": level,
        "name": info["name"],
        "path": info["path"],
        "status_path": status_path,
        "probed_url": None,
        "success": False,
        "data": None,
        "error": " | ".join(errors) if errors else "All connection attempts failed",
        "latency_ms": latency_ms,
        "reported_level": None,
        "identity_match": None,
    }


@router.get("/health")
async def meta_conductor_health() -> Dict[str, Any]:
    async with httpx.AsyncClient() as client:
        results = await asyncio.gather(*[_probe_level(client, lvl, 5.0) for lvl in sorted(PROBE_LEVELS.keys())])

    failed_levels = [r["level"] for r in results if not r.get("success")]
    identity_mismatch_levels = [r["level"] for r in results if r.get("identity_match") is False]
    timeout_levels = [r["level"] for r in results if "timeout" in str(r.get("error") or "").lower()]
    healthy_count = len(results) - len(failed_levels)
    total = len(results)
    health_pct = round((healthy_count / total) * 100.0, 1) if total else 0.0

    return {
        "success": True,
        "service": "meta_conductor",
        "status": "healthy" if not failed_levels else ("degraded" if healthy_count > 0 else "unhealthy"),
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "activation_metadata_source": "meta_conductor",
        "health_pct": health_pct,
        "failed_levels": failed_levels,
        "identity_mismatch_levels": identity_mismatch_levels,
        "timeout_levels": timeout_levels,
        "results": results,
        "kernel_v2": cortex_kernel_v2.performance_snapshot(runtime="meta_conductor"),
        "contract": {
            "identity_phrase": "Cortex-first orchestration active",
            "activation_metadata_available": True,
            "activation_metadata_source": "meta_conductor",
        },
    }


@router.get("/status")
async def meta_conductor_status() -> Dict[str, Any]:
    levels = _status_levels()
    return {
        "success": True,
        "level": 36,
        "name": "Conductor (Meta)",
        "status": "active",
        "total_levels": len(levels),
        "levels": levels,
        "activation_metadata_available": True,
        "activation_metadata_source": "meta_conductor",
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "kernel_v2": cortex_kernel_v2.performance_snapshot(runtime="meta_conductor"),
        "contract": {
            "identity_phrase": "Cortex-first orchestration active",
            "activation_metadata_available": True,
            "activation_metadata_source": "meta_conductor",
        },
    }


@router.get("/kernel/status")
async def meta_conductor_kernel_status() -> Dict[str, Any]:
    return {"success": True, **cortex_kernel_v2.performance_snapshot(runtime="meta_conductor")}


@router.get("/kernel/telemetry")
async def meta_conductor_kernel_telemetry(limit: int = 25) -> Dict[str, Any]:
    return {"success": True, **cortex_kernel_v2.diagnostic_bundle(runtime="meta_conductor", limit=limit)}


@router.post("/orchestrate")
async def meta_conductor_orchestrate(req: OrchestrateRequest) -> Dict[str, Any]:
    kernel_trace = cortex_kernel_v2.prepare_request(
        req.query,
        response_mode="meta_conductor_orchestrate",
        requested_model="meta_conductor",
        runtime="meta_conductor",
        surface="orchestrate",
    )
    try:
        data = await orchestrate_query(req.query, request=None)
    except Exception as e:
        cortex_kernel_v2.finalize_request(
            kernel_trace.get("request_id"),
            response="",
            actual_lane="meta_conductor_orchestrated",
            used_backend="delegated_nexus",
            fallback_reason="delegation_failed",
            contract_ok=False,
            error=f"{type(e).__name__}:{str(e)[:160]}",
        )
        raise HTTPException(status_code=502, detail=f"Nexus delegation failed: {e}")

    contract = data.get("contract") if isinstance(data, dict) else {}
    if not isinstance(contract, dict):
        contract = {}
    contract["activation_metadata_available"] = True
    contract["activation_metadata_source"] = "meta_conductor"
    contract["identity_phrase"] = "Cortex-first orchestration active"
    contract["kernel_contract_version"] = (kernel_trace.get("contract") or {}).get("version")
    contract["kernel_lane"] = (kernel_trace.get("plan") or {}).get("lane")

    target_levels = req.target_levels if req.target_levels else [33, 34, 35]
    target_levels = [lvl for lvl in target_levels if lvl in PROBE_LEVELS]
    async with httpx.AsyncClient() as client:
        results = await asyncio.gather(*[_probe_level(client, lvl, req.timeout_seconds) for lvl in target_levels])

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
        "contract": {
            "identity_phrase": "Cortex-first orchestration active",
            "activation_metadata_available": True,
            "activation_metadata_source": "meta_conductor",
            "contract_version": "cortex.contract.v1",
        },
        "levels": levels,
    }
