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
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
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
    _supersede_prior_fact_versions,
)

router = APIRouter()
_STRUCTURED_MEMORY_LOCK = threading.RLock()
_STRUCTURED_DB_INITIALIZED_PATHS: set[str] = set()
_CODEC_MAX_CONTENT_BYTES = max(1024, min(int(os.getenv("CORTEX_L22_CODEC_MAX_CONTENT_BYTES", "524288")), 524288))
_GENERIC_MAX_CONTENT_BYTES = max(1024, int(os.getenv("CORTEX_L22_GENERIC_MAX_CONTENT_BYTES", "1048576")))
_METADATA_MAX_BYTES = max(1024, int(os.getenv("CORTEX_L22_METADATA_MAX_BYTES", "65536")))
_MAX_PHYSICAL_BYTES = max(0, int(os.getenv("CORTEX_L22_MAX_PHYSICAL_BYTES", str(12 * 1024 * 1024 * 1024))))
_MAX_STRUCTURED_RECORDS = max(1, int(os.getenv("CORTEX_L22_MAX_STRUCTURED_RECORDS", "100000")))
_CODEC_MAX_SESSIONS = max(1, int(os.getenv("CODEC_DURABLE_MAX_SESSIONS", "128")))
_CODEC_MAX_SNAPSHOTS_PER_SESSION = max(1, int(os.getenv("CODEC_RETENTION_MAX_SNAPSHOTS", "4")))
_RECOVERY_RESERVE_BYTES = max(0, int(os.getenv("CORTEX_L22_RECOVERY_RESERVE_BYTES", "268435456")))
_PREALLOCATE_RECOVERY_RESERVE = os.getenv("CORTEX_L22_PREALLOCATE_RECOVERY_RESERVE", "true").strip().lower() in {
    "1", "true", "yes", "on",
}
_UUID_DIR_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", re.IGNORECASE)


def _structured_memory_db_path() -> Path:
    return Path(os.getenv("CORTEX_L22_STRUCTURED_DB", str(Path(CHROMA_DIR) / "l22_structured.sqlite3")))


def _recovery_reserve_path() -> Path:
    return Path(os.getenv("CORTEX_L22_RECOVERY_RESERVE_FILE", str(_structured_memory_db_path().parent / ".l22-physical-recovery-reserve")))


def _path_size(path: Path) -> int:
    try:
        return int(path.stat().st_size) if path.is_file() else 0
    except OSError:
        return 0


def _l22_active_physical_usage() -> int:
    """Count only active SQLite/Chroma data, never quarantine or backup artifacts."""
    db_path = _structured_memory_db_path()
    root = db_path.parent
    total = sum(_path_size(Path(f"{db_path}{suffix}")) for suffix in ("", "-wal", "-shm"))
    chroma_db = root / "chroma.sqlite3"
    total += sum(_path_size(Path(f"{chroma_db}{suffix}")) for suffix in ("", "-wal", "-shm"))
    try:
        children = list(root.iterdir())
    except OSError:
        children = []
    for child in children:
        if not child.is_dir() or not _UUID_DIR_RE.fullmatch(child.name):
            continue
        try:
            total += sum(_path_size(candidate) for candidate in child.rglob("*") if candidate.is_file())
        except OSError:
            continue
    return total


def _preallocate_recovery_reserve() -> None:
    if not _PREALLOCATE_RECOVERY_RESERVE or _RECOVERY_RESERVE_BYTES <= 0:
        return
    reserve = _recovery_reserve_path()
    reserve.parent.mkdir(parents=True, exist_ok=True)
    if _path_size(reserve) == _RECOVERY_RESERVE_BYTES:
        return
    temporary = reserve.with_name(f".{reserve.name}.{os.getpid()}.{uuid.uuid4().hex}.tmp")
    try:
        with temporary.open("wb") as handle:
            chunk = b"\0" * (1024 * 1024)
            remaining = _RECOVERY_RESERVE_BYTES
            while remaining > 0:
                part = chunk if remaining >= len(chunk) else chunk[:remaining]
                handle.write(part)
                remaining -= len(part)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, reserve)
    finally:
        temporary.unlink(missing_ok=True)


def _structured_schema_exists(connection: sqlite3.Connection) -> bool:
    return connection.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='structured_memory' LIMIT 1"
    ).fetchone() is not None


def _structured_memory_connection() -> sqlite3.Connection:
    db_path = _structured_memory_db_path()
    db_path.parent.mkdir(parents=True, exist_ok=True)
    db_key = str(db_path.resolve())
    connection = sqlite3.connect(str(db_path), timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA busy_timeout=10000")
    with _STRUCTURED_MEMORY_LOCK:
        if db_key not in _STRUCTURED_DB_INITIALIZED_PATHS or not _structured_schema_exists(connection):
            connection.execute("PRAGMA journal_mode=WAL")
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
            connection.commit()
            _STRUCTURED_DB_INITIALIZED_PATHS.add(db_key)
    return connection


def _prune_codec_records(connection: sqlite3.Connection) -> int:
    rows = connection.execute(
        "SELECT id, lookup_key, created_at FROM structured_memory "
        "WHERE memory_type = 'codec_state' ORDER BY created_at DESC, id DESC"
    ).fetchall()
    session_latest: dict[str, str] = {}
    for row in rows:
        key = str(row["lookup_key"] or "")
        session_latest.setdefault(key, str(row["created_at"] or ""))
    allowed_sessions = {
        key for key, _ in sorted(session_latest.items(), key=lambda item: (item[1], item[0]), reverse=True)[:_CODEC_MAX_SESSIONS]
    }
    seen: dict[str, int] = {}
    delete_ids: List[str] = []
    for row in rows:
        key = str(row["lookup_key"] or "")
        seen[key] = seen.get(key, 0) + 1
        if key not in allowed_sessions or seen[key] > _CODEC_MAX_SNAPSHOTS_PER_SESSION:
            delete_ids.append(str(row["id"]))
    if not delete_ids:
        return 0
    for offset in range(0, len(delete_ids), 500):
        batch = delete_ids[offset:offset + 500]
        placeholders = ",".join("?" for _ in batch)
        connection.execute(f"DELETE FROM structured_memory WHERE id IN ({placeholders})", batch)
    return len(delete_ids)


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
    content_bytes = len(content.encode("utf-8"))
    content_limit = _CODEC_MAX_CONTENT_BYTES if resolved_type == "codec_state" else _GENERIC_MAX_CONTENT_BYTES
    if content_bytes > content_limit:
        raise HTTPException(
            status_code=413,
            detail=f"{resolved_type} exceeds bounded L22 record size ({content_bytes} > {content_limit} bytes)",
        )
    record_metadata.setdefault("type", resolved_type)
    if tags:
        record_metadata.setdefault("tags", list(tags))
    record_metadata.setdefault("persistence_backend", "l22_structured_sqlite_v1")
    lookup_key = str(record_metadata.get("codec_session_key") or record_metadata.get("lookup_key") or "")
    if resolved_type == "codec_state" and not lookup_key:
        raise HTTPException(status_code=400, detail="Codec state requires a non-empty session lookup key")
    created_at = str(record_metadata.get("codec_generated_at") or record_metadata.get("generated_at") or datetime.now(timezone.utc).isoformat())
    metadata_json = json.dumps(record_metadata, ensure_ascii=False, sort_keys=True)
    metadata_bytes = len(metadata_json.encode("utf-8"))
    if metadata_bytes > _METADATA_MAX_BYTES:
        raise HTTPException(status_code=413, detail=f"L22 metadata exceeds bounded size ({metadata_bytes} > {_METADATA_MAX_BYTES} bytes)")
    estimated_charge = content_bytes + metadata_bytes + 4096
    if _MAX_PHYSICAL_BYTES and _l22_active_physical_usage() + estimated_charge > _MAX_PHYSICAL_BYTES:
        raise HTTPException(status_code=507, detail="L22 active physical storage quota exceeded")

    with _STRUCTURED_MEMORY_LOCK:
        connection = _structured_memory_connection()
        try:
            record_count = int(connection.execute("SELECT COUNT(*) FROM structured_memory").fetchone()[0])
            if record_count >= _MAX_STRUCTURED_RECORDS and resolved_type != "codec_state":
                raise HTTPException(status_code=507, detail="L22 structured record quota exceeded")
            connection.execute(
                "INSERT INTO structured_memory(id, memory_type, lookup_key, content, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                (memory_id, resolved_type, lookup_key, content, metadata_json, created_at),
            )
            pruned = _prune_codec_records(connection) if resolved_type == "codec_state" else 0
            connection.commit()
        finally:
            connection.close()
    return {"id": memory_id, "status": "stored", "metadata": record_metadata, "backend": "l22_structured_sqlite_v1", "pruned_records": pruned}


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

    collection.add(ids=[memory_id], documents=[content], metadatas=[record_metadata])
    fact_key = str(record_metadata.get("fact_key") or "").strip()
    if fact_key:
        _supersede_prior_fact_versions(fact_key, superseded_by=memory_id)
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


@router.on_event("startup")
async def ensure_l22_recovery_reserve() -> None:
    _preallocate_recovery_reserve()
    # Enforce the bounded retention contract immediately, including databases
    # created by an older release that accumulated amplified Codec snapshots.
    with _STRUCTURED_MEMORY_LOCK:
        connection = _structured_memory_connection()
        try:
            _prune_codec_records(connection)
            connection.commit()
        finally:
            connection.close()


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
            "exact_structured_persistence",
        ],
        "memory_count": memory_count,
        "structured_memory_count": structured_memory_count,
        "structured_memory_backend": "l22_structured_sqlite_v1",
        "active_physical_bytes": _l22_active_physical_usage(),
        "max_physical_bytes": _MAX_PHYSICAL_BYTES,
        "codec_max_content_bytes": _CODEC_MAX_CONTENT_BYTES,
        "codec_max_sessions": _CODEC_MAX_SESSIONS,
        "codec_max_snapshots_per_session": _CODEC_MAX_SNAPSHOTS_PER_SESSION,
        "recovery_reserve_bytes": _path_size(_recovery_reserve_path()),
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
