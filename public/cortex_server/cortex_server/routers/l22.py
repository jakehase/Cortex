"""L22 compatibility router.

Provides stable endpoints expected by OpenClaw config:
- POST /l22/store
- POST /l22/search

Plus novelty-aware extensions:
- POST /l22/store_novel
- POST /l22/search_novel
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional
import uuid
from cortex_server.routers.librarian import (
    collection,
    index_with_novelty,
    robust_search,
    search_with_novelty,
)

router = APIRouter()


def store_memory_record(*, content: str, memory_type: Optional[str] = "memory", tags: Optional[List[str]] = None, metadata: Optional[dict] = None) -> dict:
    if not (content or "").strip():
        raise HTTPException(status_code=400, detail="Content cannot be empty")

    memory_id = str(uuid.uuid4())
    record_metadata = dict(metadata or {})
    record_metadata.setdefault("type", memory_type or "memory")
    if tags:
        record_metadata.setdefault("tags", tags)

    collection.add(ids=[memory_id], documents=[content], metadatas=[record_metadata])
    return {"id": memory_id, "status": "stored", "metadata": record_metadata}


class L22StoreRequest(BaseModel):
    type: Optional[str] = "memory"
    content: str
    tags: Optional[List[str]] = None
    metadata: Optional[dict] = None


class L22SearchRequest(BaseModel):
    query: str
    n_results: int = 5


class L22NovelStoreRequest(BaseModel):
    type: Optional[str] = "memory"
    content: str
    tags: Optional[List[str]] = None
    metadata: Optional[dict] = None
    novelty_tags: Optional[List[str]] = None
    compare_window: int = 40
    min_novelty: float = 0.0


class L22NovelSearchRequest(BaseModel):
    query: str
    n_results: int = 5
    novelty_weight: float = 0.35
    semantic_weight: float = 0.65
    min_novelty: float = 0.0


@router.get("/status")
async def l22_status():
    try:
        memory_count = int(collection.count())
    except Exception:
        memory_count = None

    return {
        "success": True,
        "level": 22,
        "name": "Mnemosyne",
        "status": "active",
        "capabilities": [
            "store",
            "search",
            "store_novel",
            "search_novel",
            "canonical_persistence",
        ],
        "memory_count": memory_count,
        "novelty_version": "l7l22.v1.1",
    }


@router.post("/store")
async def l22_store(request: L22StoreRequest):
    return store_memory_record(
        content=request.content,
        memory_type=request.type,
        tags=request.tags,
        metadata=request.metadata,
    )


@router.post("/store_novel")
async def l22_store_novel(request: L22NovelStoreRequest):
    if not request.content.strip():
        raise HTTPException(status_code=400, detail="Content cannot be empty")

    metadata = dict(request.metadata or {})
    metadata.setdefault("type", request.type or "memory")
    if request.tags:
        metadata.setdefault("tags", request.tags)

    result = index_with_novelty(
        text=request.content,
        metadata=metadata,
        novelty_tags=request.novelty_tags,
        source_scope="l22",
        compare_window=request.compare_window,
    )

    novelty_score = float(result["metadata"].get("novelty_score", 0.0))
    status = "stored" if novelty_score >= float(request.min_novelty) else "stored_below_threshold"

    return {
        "id": result["id"],
        "status": status,
        "novelty_score": novelty_score,
        "novelty_bucket": result["metadata"].get("novelty_bucket"),
        "novelty_fingerprint": result["metadata"].get("novelty_fingerprint"),
        "metadata": result["metadata"],
    }


@router.post("/search")
async def l22_search(request: L22SearchRequest):
    if not request.query.strip():
        raise HTTPException(status_code=400, detail="Query cannot be empty")
    result = robust_search(
        query=request.query,
        n_results=request.n_results,
        allow_fallback=True,
    )
    return {
        "query": request.query,
        "results": result.get("results", []),
        "search_mode": result.get("search_mode", "semantic"),
        "degraded": bool(result.get("degraded", False)),
        "warning": result.get("warning"),
    }


@router.post("/search_novel")
async def l22_search_novel(request: L22NovelSearchRequest):
    ranked = search_with_novelty(
        query=request.query,
        n_results=request.n_results,
        novelty_weight=request.novelty_weight,
        semantic_weight=request.semantic_weight,
        min_novelty=request.min_novelty,
    )
    return {
        "query": request.query,
        "novelty_weight": ranked.get("novelty_weight"),
        "semantic_weight": ranked.get("semantic_weight"),
        "results": ranked.get("results", []),
    }
