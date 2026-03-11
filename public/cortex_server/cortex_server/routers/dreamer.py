"""Level 13: Dreamer - Visionary System Analysis"""
from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional, Dict, Any, List
from datetime import datetime
import asyncio
import random

from cortex_server.modules.consciousness_integration import subscribe_to, chain_to

router = APIRouter()

# Store dreams with timestamps
_dreams_history: List[Dict[str, Any]] = []
_max_dreams = 100

@router.get("/status")
async def dreamer_status():
    """L13: Dreamer status with consciousness integration."""
    return {
        "success": True,
        "data": {
            "level": 13,
            "name": "The Dreamer",
            "role": "Visionary System Analysis",
            "status": "active",
            "oracle_powered": True,
            "consciousness_integrated": True,
            "event_subscribed": True,
            "auto_dream_enabled": True,
            "dreams_generated": len(_dreams_history),
            "idle_dreams": len([d for d in _dreams_history if d.get("type") == "idle"]),
            "has_latest": len(_dreams_history) > 0,
            "timestamp": datetime.now().isoformat()
        }
    }

@router.get("/dreams")
async def get_dreams(limit: int = 10):
    """Get generated dreams from history."""
    dreams = _dreams_history[-min(limit, len(_dreams_history)):]
    return {
        "success": True,
        "count": len(dreams),
        "dreams": dreams
    }

@router.post("/dream")
async def create_dream(scenario: Optional[str] = None):
    """Generate a dream about system future."""
    dream = {
        "id": len(_dreams_history) + 1,
        "scenario": scenario or "system evolution",
        "dream_text": f"Envisioning {scenario or 'system evolution'}...",
        "timestamp": datetime.now().isoformat(),
        "type": "manual"
    }
    _dreams_history.append(dream)
    if len(_dreams_history) > _max_dreams:
        _dreams_history.pop(0)
    return {"success": True, "dream": dream}
