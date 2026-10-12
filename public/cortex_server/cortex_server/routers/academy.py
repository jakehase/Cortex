"""
Level 16: The Academy — model-backed learning and teaching.

* POST /academy/learn — structured learning module from gpt-5.6-sol (via the
  Oracle lane, ``level_model``) with a verified completion receipt.
* POST /academy/teach — pattern extraction; every pattern must quote the
  supplied material verbatim or it is dropped. Stored per principal.
* GET /academy/patterns — the caller's persisted teach entries.
* GET /academy/status — derived from the store and the model lane's observed
  outcomes since boot.

Model failures return HTTP 200 with ``success: false`` and no invented module.
"""
from typing import List, Literal, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from cortex_server.modules import academy as academy_core
from cortex_server.modules import level_model

router = APIRouter()

MAX_CONTENT_CHARS = academy_core.MAX_CONTENT_CHARS


class LearnRequest(BaseModel):
    topic: str = Field(max_length=2000)
    depth: Optional[Literal["beginner", "intermediate", "advanced"]] = "intermediate"
    context: Optional[str] = Field(default=None, max_length=20000)


class TeachRequest(BaseModel):
    content: str = Field(max_length=400_000)
    tags: Optional[List[str]] = Field(default_factory=list, max_length=50)
    source: Optional[str] = Field(default="user", max_length=200)


def _scope(http_request: Request) -> str:
    return level_model.scope_key_for_request(http_request, "academy")


@router.get("/status")
async def academy_status():
    """L16 status from real state: store kind/durability and model outcomes."""
    stats = academy_core.stats_snapshot()
    store = academy_core.get_store()
    last = stats.get("last_model_status")
    if last is None:
        model_health = "unverified"
    elif last == "ok":
        model_health = "ok"
    else:
        model_health = "degraded"
    capabilities: List[str] = []
    if model_health != "degraded":
        capabilities += ["model_learning_modules", "evidence_checked_pattern_extraction"]
    capabilities.append("durable_principal_store" if store.durable else "in_memory_principal_store")
    counts = store.counts()
    calls = int(stats.get("model_calls", 0))
    return {
        "success": True,
        "level": 16,
        "name": "The Academy",
        "status": "active" if model_health != "degraded" and store.durable else "degraded",
        "degraded": model_health == "degraded" or not store.durable,
        "model_lane": "level_model (gpt-5.6-sol through the Oracle lane)",
        "model_health": model_health,
        "last_model_status": last,
        "last_model_at": stats.get("last_model_at"),
        "last_model_success_at": stats.get("last_model_success_at"),
        "oracle_calls": calls,
        "oracle_successes": stats.get("model_successes", 0),
        "oracle_failures": stats.get("model_failures", 0),
        "oracle_success_rate_pct": round(100.0 * stats.get("model_successes", 0) / calls, 1) if calls else None,
        "cache_hits": stats.get("cache_hits", 0),
        "cache_misses": stats.get("cache_misses", 0),
        "patterns_dropped_unverified": stats.get("patterns_dropped_unverified", 0),
        "counters_scope": "since_boot",
        "counters_since": stats.get("since"),
        "store": store.describe(),
        "knowledge_entries": counts["teach_entries"],
        "topics_learned": counts["learn_modules"],
        "capabilities": capabilities,
    }


@router.post("/learn")
async def academy_learn(request: LearnRequest, http_request: Request):
    """Learn a topic via a model-generated structured learning module."""
    try:
        return await academy_core.learn(
            request.topic,
            principal_scope_key=_scope(http_request),
            depth=request.depth or "intermediate",
            context=request.context,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@router.post("/teach")
async def academy_teach(request: TeachRequest, http_request: Request):
    """Teach material; extract evidence-checked patterns; persist per principal."""
    try:
        return await academy_core.teach(
            request.content,
            principal_scope_key=_scope(http_request),
            tags=request.tags or [],
            source=request.source or "user",
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@router.get("/patterns")
async def academy_patterns(http_request: Request, limit: int = 50):
    """Return the caller's persisted teach entries and their patterns."""
    return academy_core.list_patterns(_scope(http_request), limit=limit)
