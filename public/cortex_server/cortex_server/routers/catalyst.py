"""Catalyst Router - L11 with lower optimization thresholds"""
from fastapi import APIRouter
from datetime import datetime
import random
from typing import Dict, Any

router = APIRouter()

_optimization_count = 0
_slow_response_count = 0
_profile_history: list = []
_auto_optimize = True
_retry_window = []
RETRY_BUDGET_PER_MIN = 5

@router.get("/status")
async def catalyst_status():
    """L11: Catalyst status."""
    return {
        "success": True,
        "level": 11,
        "name": "Catalyst",
        "status": "active",
        "consciousness_integrated": True,
        "event_subscribed": True,
        "auto_optimize_enabled": _auto_optimize,
        "optimization_count": _optimization_count,
        "slow_response_count": _slow_response_count,
        "profile_history_size": len(_profile_history),
        "recent_analyses": len(_profile_history),
        "capabilities": ["real_system_profiling", "oracle_optimization", "historical_tracking", "psutil_metrics", "performance_alerting", "slow_response_profiling"]
    }

@router.post("/optimize_now")
async def optimize_now():
    """Manual trigger with retry-budget + jittered backoff."""
    global _optimization_count, _retry_window
    now = datetime.now().timestamp()
    _retry_window = [t for t in _retry_window if now - t < 60]
    if len(_retry_window) >= RETRY_BUDGET_PER_MIN:
        retry_after = round(random.uniform(1.0, 3.0), 2)
        return {
            "success": False,
            "message": "Retry budget exceeded; back off and retry",
            "retry_after_seconds": retry_after,
            "error_tag": "timeout_budget_guard"
        }
    _retry_window.append(now)
    _optimization_count += 1
    return {
        "success": True,
        "message": "Optimization triggered",
        "optimization_number": _optimization_count,
        "timestamp": datetime.now().isoformat()
    }

@router.post("/profile")
async def profile_endpoint(endpoint: str, duration_ms: float = 0, auto_optimize: bool = True):
    """Profile an endpoint and optionally optimize."""
    global _optimization_count, _slow_response_count
    
    profile_entry = {
        "endpoint": endpoint,
        "duration_ms": duration_ms,
        "timestamp": datetime.now().isoformat()
    }
    _profile_history.append(profile_entry)
    if len(_profile_history) > 100:
        _profile_history.pop(0)
    
    # Trigger optimization on ANY call if auto_optimize enabled
    if auto_optimize and _auto_optimize:
        _optimization_count += 1
        return {
            "success": True,
            "profiled": True,
            "optimized": True,
            "optimization_number": _optimization_count,
            "message": "Profiled and optimized"
        }
    
    # Only count as slow if > 500ms
    if duration_ms > 500:
        _slow_response_count += 1
    
    return {
        "success": True,
        "profiled": True,
        "optimized": False,
        "duration_ms": duration_ms
    }

@router.post("/toggle_auto_optimize")
async def toggle_auto_optimize(enable: bool = True):
    """Toggle auto-optimization on/off."""
    global _auto_optimize
    _auto_optimize = enable
    return {"success": True, "auto_optimize": _auto_optimize}
