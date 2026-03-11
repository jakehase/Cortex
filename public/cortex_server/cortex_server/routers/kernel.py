"""Kernel compatibility endpoints."""

from datetime import datetime
from typing import Any, Dict, List

from fastapi import APIRouter

from cortex_server.modules.level_registry import LEVEL_REGISTRY_VERSION, get_level_entry, get_level_registry

router = APIRouter()


def _default_levels() -> List[Dict[str, Any]]:
    levels: List[Dict[str, Any]] = []
    for row in get_level_registry():
        levels.append(
            {
                "level": row["level"],
                "name": row["name"],
                "status": "online",
                "canonical_status": row["canonical_status"],
            }
        )
    return levels


@router.get("/levels")
async def kernel_levels() -> Dict[str, Any]:
    levels = _default_levels()
    return {
        "success": True,
        "registry_version": LEVEL_REGISTRY_VERSION,
        "levels": levels,
        "timestamp": datetime.utcnow().isoformat() + "Z",
    }


@router.get("/status")
async def kernel_status() -> Dict[str, Any]:
    entry = get_level_entry(1) or {"level": 1, "name": "Kernel", "canonical_status": "/kernel/status"}
    return {
        "success": True,
        "level": entry["level"],
        "name": entry["name"],
        "status": "online",
        "canonical_status": entry["canonical_status"],
        "registry_version": LEVEL_REGISTRY_VERSION,
        "timestamp": datetime.utcnow().isoformat() + "Z",
    }
