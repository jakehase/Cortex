"""Kernel compatibility endpoints."""

from datetime import datetime
from typing import Any, Dict, List

from fastapi import APIRouter

router = APIRouter()


def _default_levels() -> List[Dict[str, Any]]:
    levels = []
    for i in range(1, 39):
        levels.append({"level": i, "status": "online" if i not in {31} else "degraded"})
    return levels


@router.get("/levels")
async def kernel_levels() -> Dict[str, Any]:
    levels = _default_levels()
    return {
        "success": True,
        "levels": levels,
        "timestamp": datetime.utcnow().isoformat() + "Z",
    }
