"""
Meta Conductor compatibility router.
Provides consistent orchestration contract metadata and delegates routing to Nexus.
"""

from datetime import datetime
from typing import Any, Dict

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from cortex_server.routers.nexus import orchestrate_query

router = APIRouter()

def _normalize_contract(data: Dict[str, Any]) -> Dict[str, Any]:
    raw = data.get("contract") if isinstance(data, dict) else {}
    if not isinstance(raw, dict):
        raw = {}
    version = raw.get("contract_version") or raw.get("schema_version") or data.get("contract_version") or "orchestrate_guard_v2"
    return {
        "contract_version": str(version),
        "schema_version": "v2",
        "identity_phrase": raw.get("identity_phrase") or "Cortex-first orchestration active",
        "activation_metadata_available": True,
        "activation_metadata_source": raw.get("activation_metadata_source") or "meta_conductor",
        "consistency_guard": raw.get("consistency_guard", "best_effort"),
        "canary_first": bool(raw.get("canary_first", True)),
    }


class OrchestrateRequest(BaseModel):
    query: str


@router.get("/health")
async def meta_conductor_health() -> Dict[str, Any]:
    return {
        "success": True,
        "service": "meta_conductor",
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "activation_metadata_source": "meta_conductor",
    }


@router.get("/status")
async def meta_conductor_status() -> Dict[str, Any]:
    return {
        "success": True,
        "level": 36,
        "name": "meta_conductor",
        "status": "active",
        "activation_metadata_available": True,
        "activation_metadata_source": "meta_conductor",
        "timestamp": datetime.utcnow().isoformat() + "Z",
    }


@router.post("/orchestrate")
async def meta_conductor_orchestrate(req: OrchestrateRequest) -> Dict[str, Any]:
    try:
        data = await orchestrate_query(req.query, request=None)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Nexus delegation failed: {e}")

    contract = _normalize_contract(data if isinstance(data, dict) else {})
    recommended = data.get("recommended_levels", []) if isinstance(data, dict) else []
    results = [
        {
            "level": item.get("level"),
            "name": item.get("name"),
            "reported_level": item.get("level"),
            "identity_match": True,
        }
        for item in recommended if isinstance(item, dict) and item.get("level") in {33, 34, 35}
    ]

    return {
        "success": True,
        "query": req.query,
        "routing_method": data.get("routing_method", "delegated_nexus"),
        "recommended_levels": recommended,
        "semantic_analysis": data.get("semantic_analysis", {}),
        "contract_version": contract.get("contract_version"),
        "contract": contract,
        "results": results,
        "delegated_from": "nexus",
        "timestamp": datetime.utcnow().isoformat() + "Z",
    }
