"""L22 compatibility router.

Provides stable endpoints expected by OpenClaw config:
- POST /l22/store
- POST /l22/search

Plus novelty-aware extensions:
- POST /l22/store_novel
- POST /l22/search_novel
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, field_validator
from typing import List, Optional
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import sqlite3
import threading
import uuid
from cortex_server.routers.librarian import (
    CHROMA_DIR,
    collection,
    index_with_novelty,
    robust_search,
    search_with_novelty,
    _normalize_memory_metadata,
    _add_memory_with_supersession,
    FactSupersessionError,
    MemoryTag,
    _validate_memory_metadata,
)

router = APIRouter()
_STRUCTURED_MEMORY_LOCK = threading.RLock()


def _structured_memory_db_path() -> Path:
    return Path(os.getenv("CORTEX_L22_STRUCTURED_DB", str(Path(CHROMA_DIR) / "l22_structured.sqlite3")))


def _structured_memory_connection() -> sqlite3.Connection:
    db_path = _structured_memory_db_path()
    db_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(str(db_path), timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA busy_timeout=10000")
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS structured_memory (
            id TEXT PRIMARY KEY,
            memory_type TEXT NOT NULL,
            lookup_key TEXT NOT NULL DEFAULT '',
            content TEXT NOT NULL,
            metadata_json TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
        """
    )
    connection.execute(
        "CREATE INDEX IF NOT EXISTS idx_structured_memory_type_key_created "
        "ON structured_memory(memory_type, lookup_key, created_at DESC)"
    )
    return connection


def store_structured_memory_record(*, content: str, memory_type: Optional[str] = "memory", tags: Optional[List[str]] = None, metadata: Optional[dict] = None) -> dict:
    """Persist exact-lookup L22 state without invoking the semantic embedding path.

    Structured snapshots such as Codec session state are retrieved by metadata key,
    not similarity. Keeping them in this indexed L22 ledger avoids expensive Chroma
    scans/embeddings while preserving process-restart durability.
    """
    if not (content or "").strip():
        raise HTTPException(status_code=400, detail="Content cannot be empty")

    memory_id = str(uuid.uuid4())
    record_metadata = _normalize_memory_metadata(metadata)
    resolved_type = str(memory_type or record_metadata.get("type") or "memory")
    record_metadata.setdefault("type", resolved_type)
    if tags:
        record_metadata.setdefault("tags", list(tags))
    record_metadata.setdefault("persistence_backend", "l22_structured_sqlite_v1")
    lookup_key = str(record_metadata.get("codec_session_key") or record_metadata.get("lookup_key") or "")
    created_at = str(record_metadata.get("codec_generated_at") or record_metadata.get("generated_at") or datetime.now(timezone.utc).isoformat())

    with _STRUCTURED_MEMORY_LOCK:
        connection = _structured_memory_connection()
        try:
            connection.execute(
                "INSERT INTO structured_memory(id, memory_type, lookup_key, content, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                (memory_id, resolved_type, lookup_key, content, json.dumps(record_metadata, ensure_ascii=False, sort_keys=True), created_at),
            )
            connection.commit()
        finally:
            connection.close()
    return {"id": memory_id, "status": "stored", "metadata": record_metadata, "backend": "l22_structured_sqlite_v1"}


def list_structured_memory_records(*, memory_type: Optional[str] = None, lookup_key: Optional[str] = None, limit: int = 25) -> List[dict]:
    clauses = []
    params: List[object] = []
    if memory_type:
        clauses.append("memory_type = ?")
        params.append(str(memory_type))
    if lookup_key is not None:
        clauses.append("lookup_key = ?")
        params.append(str(lookup_key))
    where = f" WHERE {' AND '.join(clauses)}" if clauses else ""
    query = f"SELECT id, memory_type, lookup_key, content, metadata_json, created_at FROM structured_memory{where} ORDER BY created_at DESC LIMIT ?"
    params.append(max(1, min(int(limit), 1000)))

    with _STRUCTURED_MEMORY_LOCK:
        connection = _structured_memory_connection()
        try:
            rows = connection.execute(query, params).fetchall()
        finally:
            connection.close()
    records = []
    for row in rows:
        try:
            metadata = json.loads(row["metadata_json"] or "{}")
        except Exception:
            metadata = {}
        records.append({
            "id": row["id"],
            "type": row["memory_type"],
            "lookup_key": row["lookup_key"],
            "content": row["content"],
            "metadata": metadata,
            "created_at": row["created_at"],
        })
    return records


def delete_structured_memory_records(ids: List[str]) -> int:
    normalized = [str(value) for value in ids if str(value or "").strip()]
    if not normalized:
        return 0
    placeholders = ",".join("?" for _ in normalized)
    with _STRUCTURED_MEMORY_LOCK:
        connection = _structured_memory_connection()
        try:
            cursor = connection.execute(f"DELETE FROM structured_memory WHERE id IN ({placeholders})", normalized)
            connection.commit()
            deleted = int(cursor.rowcount or 0)
        finally:
            connection.close()
    return deleted


def count_structured_memory_records() -> int:
    with _STRUCTURED_MEMORY_LOCK:
        connection = _structured_memory_connection()
        try:
            return int(connection.execute("SELECT COUNT(*) FROM structured_memory").fetchone()[0])
        finally:
            connection.close()


def store_memory_record(*, content: str, memory_type: Optional[str] = "memory", tags: Optional[List[str]] = None, metadata: Optional[dict] = None) -> dict:
    if not (content or "").strip():
        raise HTTPException(status_code=400, detail="Content cannot be empty")

    memory_id = str(uuid.uuid4())
    record_metadata = dict(metadata or {})
    record_metadata.setdefault("type", memory_type or "memory")
    if tags:
        record_metadata.setdefault("tags", tags)

    try:
        _add_memory_with_supersession(memory_id, content, record_metadata)
    except FactSupersessionError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return {"id": memory_id, "status": "stored", "metadata": record_metadata}


class L22StoreRequest(BaseModel):
    type: Optional[str] = Field("memory", max_length=128)
    content: str = Field(..., max_length=1_000_000)
    tags: Optional[List[MemoryTag]] = Field(None, max_length=100)
    metadata: Optional[dict] = None

    _bounded_metadata = field_validator("metadata")(_validate_memory_metadata)


class L22SearchRequest(BaseModel):
    query: str = Field(..., max_length=16_384)
    n_results: int = Field(5, ge=1, le=100)


class L22NovelStoreRequest(BaseModel):
    type: Optional[str] = Field("memory", max_length=128)
    content: str = Field(..., max_length=1_000_000)
    tags: Optional[List[MemoryTag]] = Field(None, max_length=100)
    metadata: Optional[dict] = None
    novelty_tags: Optional[List[MemoryTag]] = Field(None, max_length=100)
    compare_window: int = Field(40, ge=1, le=500)
    min_novelty: float = 0.0

    _bounded_metadata = field_validator("metadata")(_validate_memory_metadata)


class L22NovelSearchRequest(BaseModel):
    query: str = Field(..., max_length=16_384)
    n_results: int = Field(5, ge=1, le=100)
    novelty_weight: float = 0.35
    semantic_weight: float = 0.65
    min_novelty: float = 0.0


@router.get("/status")
async def l22_status():
    try:
        memory_count = int(collection.count())
    except Exception:
        memory_count = None
    try:
        structured_memory_count = count_structured_memory_records()
    except Exception:
        structured_memory_count = None

    available = memory_count is not None or structured_memory_count is not None
    return {
        "success": available,
        "level": 22,
        "name": "Mnemosyne",
        "status": "active" if available else "unavailable",
        "capabilities": [
            "store",
            "search",
            "store_novel",
            "search_novel",
            "canonical_persistence",
            "exact_structured_persistence",
        ],
        "memory_count": memory_count,
        "structured_memory_count": structured_memory_count,
        "structured_memory_backend": "l22_structured_sqlite_v1",
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
