"""
Meta Conductor compatibility router.
Provides consistent orchestration contract metadata and delegates routing to Nexus.
Adds legacy status/health fields expected by watchdogs.
"""

from datetime import datetime
from typing import Any, Dict, List, Optional
import asyncio
import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from cortex_server.routers.nexus import orchestrate_query
from cortex_server.modules.level_registry import LEVEL_REGISTRY_VERSION, get_level_registry

router = APIRouter()

LEGACY_LEVELS: Dict[int, Dict[str, str]] = {
    33: {"name": "Ethicist", "path": "/ethicist"},
    34: {"name": "Validator", "path": "/validator"},
    35: {"name": "Singularity", "path": "/singularity"},
    36: {"name": "Conductor (Meta)", "path": "/meta_conductor"},
    37: {"name": "Awareness", "path": "/awareness"},
    38: {"name": "Augmenter", "path": "/augmenter"},
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
    url = f"http://127.0.0.1:8888{info['path']}/status"
    started = datetime.utcnow()
    try:
        resp = await client.get(url, timeout=max(1.0, float(timeout_seconds)))
        latency_ms = round((datetime.utcnow() - started).total_seconds() * 1000, 2)
        if resp.status_code != 200:
            return {
                "level": level,
                "name": info["name"],
                "path": info["path"],
                "success": False,
                "data": None,
                "error": f"HTTP {resp.status_code}",
                "latency_ms": latency_ms,
                "reported_level": None,
                "identity_match": None,
            }
        body = resp.json()
        reported_level = _extract_reported_level(body)
        identity_match = (reported_level == level) if reported_level is not None else None
        return {
            "level": level,
            "name": info["name"],
            "path": info["path"],
            "success": bool(resp.status_code == 200 and identity_match is not False),
            "data": body,
            "error": None,
            "latency_ms": latency_ms,
            "reported_level": reported_level,
            "identity_match": identity_match,
        }
    except Exception as e:
        latency_ms = round((datetime.utcnow() - started).total_seconds() * 1000, 2)
        return {
            "level": level,
            "name": info["name"],
            "path": info["path"],
            "success": False,
            "data": None,
            "error": str(e),
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
        "contract": {
            "identity_phrase": "Cortex-first orchestration active",
            "activation_metadata_available": True,
            "activation_metadata_source": "meta_conductor",
        },
    }


@router.post("/orchestrate")
async def meta_conductor_orchestrate(req: OrchestrateRequest) -> Dict[str, Any]:
    try:
        data = await orchestrate_query(req.query, request=None)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Nexus delegation failed: {e}")

    contract = data.get("contract") if isinstance(data, dict) else {}
    if not isinstance(contract, dict):
        contract = {}
    contract["activation_metadata_available"] = True
    contract["activation_metadata_source"] = "meta_conductor"
    contract["identity_phrase"] = "Cortex-first orchestration active"

    target_levels = req.target_levels if req.target_levels else [33, 34, 35]
    target_levels = [lvl for lvl in target_levels if lvl in PROBE_LEVELS]
    async with httpx.AsyncClient() as client:
        results = await asyncio.gather(*[_probe_level(client, lvl, req.timeout_seconds) for lvl in target_levels])

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
