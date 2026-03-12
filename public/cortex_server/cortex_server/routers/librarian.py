"""The Librarian - Vector Memory Plugin for The Cortex.

Provides semantic memory storage and retrieval using ChromaDB.
Includes novelty-aware indexing and retrieval helpers used by L7/L22.
Adds resilient fallback recall paths when embedding providers fail.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
import chromadb
from chromadb.utils import embedding_functions
import uuid
import os
import shutil
import re
import json
import threading
from hashlib import sha256
from datetime import datetime, timezone
from pathlib import Path

router = APIRouter()

# Initialize ChromaDB client with persistent storage
# Use host-mounted /app path for durability across container rebuilds.
LEGACY_CHROMA_DIR = "/root/cortex_server/chroma_db"
CHROMA_DIR = "/app/cortex_server/chroma_db"
if os.path.exists(LEGACY_CHROMA_DIR) and not os.path.exists(CHROMA_DIR):
    try:
        shutil.copytree(LEGACY_CHROMA_DIR, CHROMA_DIR)
    except Exception:
        pass
os.makedirs(CHROMA_DIR, exist_ok=True)
client = chromadb.PersistentClient(path=CHROMA_DIR)

# Use default embedding function (all-MiniLM-L6-v2)
embed_fn = embedding_functions.DefaultEmbeddingFunction()

# Get or create collection
COLLECTION_NAME = "cortex_memory"
collection = client.get_or_create_collection(
    name=COLLECTION_NAME,
    embedding_function=embed_fn,
)

_FALLBACK_LOG_PATH = Path(os.getenv("LIBRARIAN_FALLBACK_LOG_PATH", f"{CHROMA_DIR}/librarian_fallback.jsonl"))
_EMBEDDING_HEALTH_LOCK = threading.Lock()
_EMBEDDING_HEALTH: Dict[str, Any] = {
    "status": "ok",
    "last_error": "",
    "last_error_at": "",
    "fallback_writes": 0,
    "fallback_searches": 0,
}


class EmbedRequest(BaseModel):
    text: str
    metadata: Optional[dict] = None


class EmbedResponse(BaseModel):
    id: str
    status: str


class SearchRequest(BaseModel):
    query: str
    n_results: int = 3
    allow_fallback: bool = True


class MemoryResult(BaseModel):
    id: str
    text: str
    distance: float
    metadata: Optional[dict]


class SearchResponse(BaseModel):
    query: str
    results: List[MemoryResult]
    search_mode: str = "semantic"
    degraded: bool = False
    warning: Optional[str] = None


class NovelEmbedRequest(BaseModel):
    text: str
    metadata: Optional[dict] = None
    novelty_tags: Optional[List[str]] = None
    compare_window: int = 40
    min_novelty: float = 0.0


class NovelEmbedResponse(BaseModel):
    id: str
    status: str
    novelty_score: float
    novelty_bucket: str
    novelty_fingerprint: str


class NovelSearchRequest(BaseModel):
    query: str
    n_results: int = 5
    novelty_weight: float = 0.28
    semantic_weight: float = 0.72
    min_novelty: float = 0.0
    allow_fallback: bool = True


class NovelSearchResult(BaseModel):
    id: str
    text: str
    distance: float
    relevance_score: float
    novelty_score: float
    combined_score: float
    metadata: Optional[dict]


class NovelSearchResponse(BaseModel):
    query: str
    novelty_weight: float
    semantic_weight: float
    results: List[NovelSearchResult]
    search_mode: str = "semantic+novelty"
    degraded: bool = False
    warning: Optional[str] = None


class RecallRequest(BaseModel):
    query: str
    n_results: int = 5


class RecallResponse(BaseModel):
    query: str
    mode: str
    results: List[MemoryResult]
    degraded: bool = False
    warning: Optional[str] = None


def _utc_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clamp01(value: float) -> float:
    return max(0.0, min(1.0, float(value)))


def _tokenize(text: str) -> List[str]:
    return [t for t in re.findall(r"[a-zA-Z0-9_]+", (text or "").lower()) if len(t) >= 3]


def _fingerprint(text: str) -> str:
    normalized = " ".join(_tokenize(text))
    return sha256(normalized.encode("utf-8")).hexdigest()[:16]


def _novelty_bucket(score: float) -> str:
    if score >= 0.85:
        return "high"
    if score >= 0.60:
        return "medium"
    return "low"


def _mark_embedding_error(exc: Exception) -> None:
    with _EMBEDDING_HEALTH_LOCK:
        _EMBEDDING_HEALTH["status"] = "degraded"
        _EMBEDDING_HEALTH["last_error"] = str(exc)[:320]
        _EMBEDDING_HEALTH["last_error_at"] = _utc_iso()


def _mark_fallback_write() -> None:
    with _EMBEDDING_HEALTH_LOCK:
        _EMBEDDING_HEALTH["fallback_writes"] = int(_EMBEDDING_HEALTH.get("fallback_writes", 0)) + 1


def _mark_fallback_search() -> None:
    with _EMBEDDING_HEALTH_LOCK:
        _EMBEDDING_HEALTH["fallback_searches"] = int(_EMBEDDING_HEALTH.get("fallback_searches", 0)) + 1


def _embedding_health_snapshot() -> Dict[str, Any]:
    with _EMBEDDING_HEALTH_LOCK:
        return dict(_EMBEDDING_HEALTH)


def _append_fallback_row(row: Dict[str, Any]) -> None:
    try:
        _FALLBACK_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        with _FALLBACK_LOG_PATH.open("a", encoding="utf-8") as f:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    except Exception:
        pass


def _read_fallback_rows(limit: int = 200) -> List[Dict[str, Any]]:
    if not _FALLBACK_LOG_PATH.exists():
        return []
    rows: List[Dict[str, Any]] = []
    try:
        with _FALLBACK_LOG_PATH.open("r", encoding="utf-8", errors="ignore") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                    if isinstance(obj, dict):
                        rows.append(obj)
                except Exception:
                    continue
    except Exception:
        return []
    if len(rows) > limit:
        rows = rows[-limit:]
    return rows


def _safe_recent_docs(limit: int = 25) -> List[Dict[str, Any]]:
    cap = max(1, min(int(limit), 200))
    try:
        data = collection.get(limit=cap, include=["documents", "metadatas"])
    except Exception:
        return []

    ids = data.get("ids") or []
    docs = data.get("documents") or []
    metas = data.get("metadatas") or []

    out: List[Dict[str, Any]] = []
    for i, _id in enumerate(ids):
        out.append(
            {
                "id": _id,
                "document": docs[i] if i < len(docs) else "",
                "metadata": metas[i] if i < len(metas) else {},
            }
        )
    return out


def _fingerprint_exists(fp: str) -> bool:
    try:
        probe = collection.get(where={"novelty_fingerprint": fp}, limit=1, include=["metadatas"])
    except Exception:
        return False
    ids = probe.get("ids") or []
    return bool(ids)


def _jaccard(a: set[str], b: set[str]) -> float:
    if not a and not b:
        return 0.0
    union = len(a | b)
    if union <= 0:
        return 0.0
    return len(a & b) / float(union)


def _estimate_novelty(text: str, recent_rows: List[Dict[str, Any]]) -> float:
    text_tokens = set(_tokenize(text))
    if not text_tokens:
        return 0.5

    text_fp = _fingerprint(text)
    if _fingerprint_exists(text_fp):
        return 0.0

    if not recent_rows:
        return 1.0
    max_overlap = 0.0
    max_jaccard = 0.0

    for row in recent_rows:
        row_doc = str(row.get("document") or "")
        if text_fp == _fingerprint(row_doc):
            return 0.0

        doc_tokens = set(_tokenize(row_doc))
        if not doc_tokens:
            continue

        overlap = len(text_tokens & doc_tokens) / float(max(1, len(text_tokens)))
        if overlap > max_overlap:
            max_overlap = overlap

        jac = _jaccard(text_tokens, doc_tokens)
        if jac > max_jaccard:
            max_jaccard = jac

    similarity = (0.65 * max_jaccard) + (0.35 * max_overlap)
    novelty = 1.0 - similarity

    # Short snippets are often deceptively unique; damp their score.
    if len(text_tokens) < 6:
        novelty = min(novelty, 0.75)

    return round(_clamp01(novelty), 4)


def _build_novel_metadata(
    text: str,
    metadata: Optional[Dict[str, Any]] = None,
    novelty_tags: Optional[List[str]] = None,
    source_scope: str = "l7",
    compare_window: int = 40,
) -> Dict[str, Any]:
    existing = dict(metadata or {})
    recent = _safe_recent_docs(compare_window)
    novelty_score = _estimate_novelty(text, recent)
    fp = _fingerprint(text)

    tags = [str(t).strip() for t in (novelty_tags or []) if str(t).strip()]
    existing_tags = existing.get("novelty_tags")
    if isinstance(existing_tags, list):
        tags.extend(str(t).strip() for t in existing_tags if str(t).strip())
    tags = sorted(set(tags))

    existing.update(
        {
            "novelty_score": novelty_score,
            "novelty_bucket": _novelty_bucket(novelty_score),
            "novelty_fingerprint": fp,
            "novelty_version": "l7l22.v1.2",
            "novelty_source_scope": source_scope,
            "novelty_indexed_at": _utc_iso(),
        }
    )
    if tags:
        existing["novelty_tags"] = tags

    return existing


def _persist_fallback_memory(
    memory_id: str,
    text: str,
    metadata: Optional[Dict[str, Any]] = None,
    *,
    reason: str,
    mode: str,
) -> None:
    _mark_fallback_write()
    row = {
        "id": memory_id,
        "text": text,
        "metadata": dict(metadata or {}),
        "stored_at": _utc_iso(),
        "source": "librarian_fallback_log",
        "reason": reason,
        "mode": mode,
    }
    _append_fallback_row(row)


def index_with_novelty(
    text: str,
    metadata: Optional[Dict[str, Any]] = None,
    novelty_tags: Optional[List[str]] = None,
    source_scope: str = "l7",
    compare_window: int = 40,
) -> Dict[str, Any]:
    if not (text or "").strip():
        raise HTTPException(status_code=400, detail="Text cannot be empty")

    memory_id = str(uuid.uuid4())
    enriched_metadata = _build_novel_metadata(
        text=text,
        metadata=metadata,
        novelty_tags=novelty_tags,
        source_scope=source_scope,
        compare_window=compare_window,
    )

    try:
        collection.add(
            ids=[memory_id],
            documents=[text],
            metadatas=[enriched_metadata],
        )
        return {
            "id": memory_id,
            "status": "stored",
            "metadata": enriched_metadata,
        }
    except Exception as exc:
        _mark_embedding_error(exc)
        _persist_fallback_memory(memory_id, text, enriched_metadata, reason=str(exc), mode="novelty_embed")
        return {
            "id": memory_id,
            "status": "stored_fallback_lexical",
            "metadata": {
                **enriched_metadata,
                "recall_mode": "lexical_fallback",
                "fallback_reason": str(exc)[:220],
            },
        }


def _relevance_from_distance(distance: float) -> float:
    try:
        d = max(0.0, float(distance))
    except Exception:
        d = 1.0
    return round(1.0 / (1.0 + d), 4)


def _lexical_score(query: str, text: str) -> float:
    q_tokens = set(_tokenize(query))
    t_tokens = set(_tokenize(text))
    if not q_tokens:
        return 0.0
    overlap = len(q_tokens & t_tokens)
    prefix_hits = sum(1 for t in q_tokens if any(tok.startswith(t[:4]) for tok in t_tokens if len(t) >= 4))
    raw = (0.75 * (overlap / max(1, len(q_tokens)))) + (0.25 * (prefix_hits / max(1, len(q_tokens))))
    return round(_clamp01(raw), 4)


def _lexical_search_rows(query: str, n_results: int = 5, scan_limit: int = 300) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []

    # Chroma documents (works even when embedding provider is currently down).
    try:
        data = collection.get(limit=max(1, min(scan_limit, 500)), include=["documents", "metadatas"])
        ids = data.get("ids") or []
        docs = data.get("documents") or []
        metas = data.get("metadatas") or []
        for i, row_id in enumerate(ids):
            text = docs[i] if i < len(docs) else ""
            metadata = metas[i] if i < len(metas) else {}
            score = _lexical_score(query, text)
            if score <= 0:
                continue
            rows.append(
                {
                    "id": row_id,
                    "text": text,
                    "distance": round(max(0.0, 1.0 - score), 4),
                    "metadata": {
                        **(metadata or {}),
                        "recall_mode": "lexical_fallback",
                        "lexical_score": score,
                        "source": (metadata or {}).get("source", "chroma_docs"),
                    },
                    "_score": score,
                }
            )
    except Exception:
        pass

    # Explicit fallback rows captured during embed failures.
    for row in _read_fallback_rows(limit=max(40, scan_limit)):
        text = str(row.get("text") or "")
        score = _lexical_score(query, text)
        if score <= 0:
            continue
        rows.append(
            {
                "id": str(row.get("id") or f"fallback-{_fingerprint(text)}"),
                "text": text,
                "distance": round(max(0.0, 1.0 - score), 4),
                "metadata": {
                    **(row.get("metadata") or {}),
                    "recall_mode": "fallback_log",
                    "lexical_score": score,
                    "source": row.get("source", "librarian_fallback_log"),
                    "stored_at": row.get("stored_at", ""),
                },
                "_score": score,
            }
        )

    dedup: Dict[str, Dict[str, Any]] = {}
    for item in rows:
        key = str(item.get("id") or "") or _fingerprint(str(item.get("text") or ""))
        prev = dedup.get(key)
        if prev is None or float(item.get("_score", 0.0)) > float(prev.get("_score", 0.0)):
            dedup[key] = item

    ordered = sorted(dedup.values(), key=lambda x: float(x.get("_score", 0.0)), reverse=True)
    return ordered[: max(1, int(n_results))]


def robust_search(query: str, n_results: int = 5, allow_fallback: bool = True) -> Dict[str, Any]:
    if not (query or "").strip():
        raise HTTPException(status_code=400, detail="Query cannot be empty")

    semantic_warning: Optional[str] = None
    try:
        results = collection.query(query_texts=[query], n_results=max(1, int(n_results)))
        out_rows: List[Dict[str, Any]] = []
        ids = results.get("ids") or []
        docs = results.get("documents") or []
        dists = results.get("distances") or []
        metas = results.get("metadatas") or []

        if ids and ids[0]:
            for i, row_id in enumerate(ids[0]):
                out_rows.append(
                    {
                        "id": row_id,
                        "text": docs[0][i] if docs and docs[0] and i < len(docs[0]) else "",
                        "distance": dists[0][i] if dists and dists[0] and i < len(dists[0]) else 0.0,
                        "metadata": metas[0][i] if metas and metas[0] and i < len(metas[0]) else None,
                    }
                )

        if out_rows:
            return {
                "query": query,
                "results": out_rows,
                "search_mode": "semantic",
                "degraded": False,
                "warning": None,
            }

        semantic_warning = "semantic_empty"
    except Exception as exc:
        _mark_embedding_error(exc)
        semantic_warning = f"semantic_failed: {str(exc)[:220]}"

    if not allow_fallback:
        return {
            "query": query,
            "results": [],
            "search_mode": "semantic",
            "degraded": bool(semantic_warning),
            "warning": semantic_warning,
        }

    _mark_fallback_search()
    lexical_rows = _lexical_search_rows(query, n_results=max(1, int(n_results)))
    for row in lexical_rows:
        row.pop("_score", None)

    return {
        "query": query,
        "results": lexical_rows,
        "search_mode": "lexical_fallback",
        "degraded": True,
        "warning": semantic_warning or "fallback_requested",
    }


def search_with_novelty(
    query: str,
    n_results: int = 5,
    novelty_weight: float = 0.28,
    semantic_weight: float = 0.72,
    min_novelty: float = 0.0,
    allow_fallback: bool = True,
) -> Dict[str, Any]:
    if not (query or "").strip():
        raise HTTPException(status_code=400, detail="Query cannot be empty")

    nw = _clamp01(novelty_weight)
    sw = _clamp01(semantic_weight)
    if nw == 0 and sw == 0:
        sw = 1.0
    total = nw + sw
    nw = nw / total
    sw = sw / total

    fetch_n = max(1, min(int(n_results) * 3, 50))
    warning: Optional[str] = None
    degraded = False

    try:
        results = collection.query(query_texts=[query], n_results=fetch_n)

        rows: List[Dict[str, Any]] = []
        ids = results.get("ids") or []
        docs = results.get("documents") or []
        dists = results.get("distances") or []
        metas = results.get("metadatas") or []

        if ids and ids[0]:
            for i, row_id in enumerate(ids[0]):
                text = docs[0][i] if docs and docs[0] and i < len(docs[0]) else ""
                metadata = metas[0][i] if metas and metas[0] and i < len(metas[0]) else {}
                dist = dists[0][i] if dists and dists[0] and i < len(dists[0]) else 0.0
                novelty_score = metadata.get("novelty_score")
                if novelty_score is None:
                    novelty_score = _estimate_novelty(text, _safe_recent_docs(limit=15))
                novelty_score = round(_clamp01(float(novelty_score)), 4)

                if novelty_score < float(min_novelty):
                    continue

                relevance = _relevance_from_distance(dist)
                combined = round((sw * relevance) + (nw * novelty_score), 4)
                rows.append(
                    {
                        "id": row_id,
                        "text": text,
                        "distance": float(dist),
                        "relevance_score": relevance,
                        "novelty_score": novelty_score,
                        "combined_score": combined,
                        "metadata": metadata,
                    }
                )

        if rows:
            rows.sort(key=lambda r: r["combined_score"], reverse=True)
            return {
                "query": query,
                "novelty_weight": round(nw, 4),
                "semantic_weight": round(sw, 4),
                "results": rows[: max(1, int(n_results))],
                "search_mode": "semantic+novelty",
                "degraded": False,
                "warning": None,
            }

        warning = "semantic_empty"
    except Exception as exc:
        _mark_embedding_error(exc)
        degraded = True
        warning = f"semantic_failed: {str(exc)[:220]}"

    if not allow_fallback:
        return {
            "query": query,
            "novelty_weight": round(nw, 4),
            "semantic_weight": round(sw, 4),
            "results": [],
            "search_mode": "semantic+novelty",
            "degraded": bool(degraded or warning),
            "warning": warning,
        }

    _mark_fallback_search()
    fallback_rows = _lexical_search_rows(query, n_results=max(1, int(n_results)), scan_limit=320)
    scored_rows: List[Dict[str, Any]] = []
    for row in fallback_rows:
        lex = float((row.get("metadata") or {}).get("lexical_score", 0.0))
        novelty_score = _estimate_novelty(str(row.get("text") or ""), _safe_recent_docs(limit=15))
        if novelty_score < float(min_novelty):
            continue
        combined = round((sw * lex) + (nw * novelty_score), 4)
        scored_rows.append(
            {
                "id": row.get("id"),
                "text": row.get("text"),
                "distance": float(row.get("distance", 1.0)),
                "relevance_score": round(lex, 4),
                "novelty_score": round(float(novelty_score), 4),
                "combined_score": combined,
                "metadata": row.get("metadata"),
            }
        )

    scored_rows.sort(key=lambda r: r["combined_score"], reverse=True)
    return {
        "query": query,
        "novelty_weight": round(nw, 4),
        "semantic_weight": round(sw, 4),
        "results": scored_rows[: max(1, int(n_results))],
        "search_mode": "lexical+novelty_fallback",
        "degraded": True,
        "warning": warning or "fallback_requested",
    }


@router.get("/status")
async def librarian_status():
    """L7 Librarian status."""
    return {
        "success": True,
        "level": 7,
        "name": "Librarian",
        "status": "active",
        "capabilities": [
            "embed",
            "search",
            "semantic_indexing",
            "embed_novel",
            "search_novel",
            "novelty_reranking",
            "robust_recall_fallback",
        ],
        "novelty_version": "l7l22.v1.2",
        "embedding_health": _embedding_health_snapshot(),
        "fallback_store": str(_FALLBACK_LOG_PATH),
    }


@router.post("/embed", response_model=EmbedResponse)
async def embed_memory(request: EmbedRequest):
    """Store text in vector memory with semantic embedding.

    If embedding providers fail, persist to fallback log so recall remains possible.
    """
    if not request.text.strip():
        raise HTTPException(status_code=400, detail="Text cannot be empty")

    memory_id = str(uuid.uuid4())
    metadata = request.metadata or {}

    try:
        collection.add(
            ids=[memory_id],
            documents=[request.text],
            metadatas=[metadata],
        )
        return EmbedResponse(id=memory_id, status="stored")
    except Exception as exc:
        _mark_embedding_error(exc)
        _persist_fallback_memory(memory_id, request.text, metadata, reason=str(exc), mode="embed")
        return EmbedResponse(id=memory_id, status="stored_fallback_lexical")


@router.post("/embed_novel", response_model=NovelEmbedResponse)
async def embed_memory_novel(request: NovelEmbedRequest):
    """Store text with novelty metadata for L7/L22 orchestration."""
    result = index_with_novelty(
        text=request.text,
        metadata=request.metadata,
        novelty_tags=request.novelty_tags,
        source_scope="l7",
        compare_window=request.compare_window,
    )

    novelty_score = float(result["metadata"].get("novelty_score", 0.0))
    if novelty_score < float(request.min_novelty):
        return NovelEmbedResponse(
            id=result["id"],
            status="stored_below_threshold",
            novelty_score=novelty_score,
            novelty_bucket=str(result["metadata"].get("novelty_bucket", "low")),
            novelty_fingerprint=str(result["metadata"].get("novelty_fingerprint", "")),
        )

    return NovelEmbedResponse(
        id=result["id"],
        status=result["status"],
        novelty_score=novelty_score,
        novelty_bucket=str(result["metadata"].get("novelty_bucket", "low")),
        novelty_fingerprint=str(result["metadata"].get("novelty_fingerprint", "")),
    )


@router.post("/search", response_model=SearchResponse)
async def search_memory(request: SearchRequest):
    """Search vector memory for semantically similar content.

    Falls back to lexical recall when semantic embedding/query is unavailable.
    """
    result = robust_search(request.query, n_results=request.n_results, allow_fallback=request.allow_fallback)
    memories = [MemoryResult(**row) for row in result.get("results", [])]
    return SearchResponse(
        query=request.query,
        results=memories,
        search_mode=str(result.get("search_mode", "semantic")),
        degraded=bool(result.get("degraded", False)),
        warning=result.get("warning"),
    )


@router.post("/search_novel", response_model=NovelSearchResponse)
async def search_memory_novel(request: NovelSearchRequest):
    """Search memory and rerank by semantic relevance + novelty."""
    ranked = search_with_novelty(
        query=request.query,
        n_results=request.n_results,
        novelty_weight=request.novelty_weight,
        semantic_weight=request.semantic_weight,
        min_novelty=request.min_novelty,
        allow_fallback=request.allow_fallback,
    )

    results = [NovelSearchResult(**row) for row in ranked.get("results", [])]
    return NovelSearchResponse(
        query=request.query,
        novelty_weight=float(ranked.get("novelty_weight", request.novelty_weight)),
        semantic_weight=float(ranked.get("semantic_weight", request.semantic_weight)),
        results=results,
        search_mode=str(ranked.get("search_mode", "semantic+novelty")),
        degraded=bool(ranked.get("degraded", False)),
        warning=ranked.get("warning"),
    )


@router.post("/recall", response_model=RecallResponse)
async def recall_memory(request: RecallRequest):
    """Trustable recall path: semantic first, lexical fallback guaranteed."""
    result = robust_search(request.query, n_results=request.n_results, allow_fallback=True)
    memories = [MemoryResult(**row) for row in result.get("results", [])]
    return RecallResponse(
        query=request.query,
        mode=str(result.get("search_mode", "semantic")),
        results=memories,
        degraded=bool(result.get("degraded", False)),
        warning=result.get("warning"),
    )


@router.get("/stats")
async def memory_stats():
    """Get statistics about the memory collection."""
    count = 0
    try:
        count = int(collection.count())
    except Exception:
        count = 0

    fallback_count = len(_read_fallback_rows(limit=10000))

    return {
        "total_memories": count,
        "fallback_memories": fallback_count,
        "collection": COLLECTION_NAME,
        "novelty_version": "l7l22.v1.2",
        "embedding_health": _embedding_health_snapshot(),
    }
