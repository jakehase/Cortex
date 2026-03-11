"""
Level 16: The Academy - Oracle-Powered Learning & Teaching
Upgraded with validation, caching, provenance, observability, and memory indexing.
"""
from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import hashlib
import time
from datetime import datetime
import httpx
import re

router = APIRouter()

# Module-level state
_topics_learned: Dict[str, Dict[str, Any]] = {}
_knowledge_base: List[Dict[str, Any]] = []
_patterns_stored: List[Dict[str, Any]] = []
_oracle_failures: int = 0
_oracle_successes: int = 0
_oracle_calls: int = 0
_last_oracle_error: Optional[str] = None
_cache_hits: int = 0
_cache_misses: int = 0
_oracle_consecutive_failures: int = 0
_oracle_breaker_open_until: float = 0.0

# L11-style perf counters
_learn_latency_ms: List[float] = []
_teach_latency_ms: List[float] = []

# Simple in-memory learn cache
_learn_cache: Dict[str, Dict[str, Any]] = {}
CACHE_TTL_SECONDS = 1800
MAX_CONTENT_CHARS = 4000
ORACLE_URL = "http://localhost:8888/oracle/chat"
ORACLE_BREAKER_THRESHOLD = 3
ORACLE_BREAKER_COOLDOWN_SECONDS = 60


class LearnRequest(BaseModel):
    topic: str
    depth: Optional[str] = "intermediate"
    context: Optional[str] = None


class TeachRequest(BaseModel):
    content: str
    tags: Optional[List[str]] = []
    source: Optional[str] = "user"


def _sanitize_text(text: str) -> str:
    # strip control chars except newline/tab
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", text)
    return text.strip()


def _clip(text: str, n: int = MAX_CONTENT_CHARS) -> str:
    return text if len(text) <= n else text[:n]


def _cache_key(topic: str, depth: str, context: Optional[str]) -> str:
    raw = f"{topic}|{depth}|{context or ''}"
    return hashlib.sha256(raw.encode()).hexdigest()[:24]


def _mean(xs: List[float]) -> float:
    return round(sum(xs) / len(xs), 1) if xs else 0.0


async def _oracle_chat(prompt: str, timeout: float = 90.0) -> tuple[Optional[str], Optional[str]]:
    global _oracle_calls, _oracle_consecutive_failures, _oracle_breaker_open_until
    _oracle_calls += 1

    now = time.time()
    if now < _oracle_breaker_open_until:
        return None, f"Oracle circuit open for {int(_oracle_breaker_open_until - now)}s"

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(
                ORACLE_URL,
                json={"prompt": prompt, "priority": "high"},
            )
            if resp.status_code != 200:
                _oracle_consecutive_failures += 1
                if _oracle_consecutive_failures >= ORACLE_BREAKER_THRESHOLD:
                    _oracle_breaker_open_until = time.time() + ORACLE_BREAKER_COOLDOWN_SECONDS
                return None, f"Oracle returned {resp.status_code}"
            data = resp.json()
            txt = data.get("response") or data.get("message") or data.get("content") or str(data)
            _oracle_consecutive_failures = 0
            return txt, None
    except Exception as e:
        _oracle_consecutive_failures += 1
        if _oracle_consecutive_failures >= ORACLE_BREAKER_THRESHOLD:
            _oracle_breaker_open_until = time.time() + ORACLE_BREAKER_COOLDOWN_SECONDS
        return None, f"Oracle unreachable: {str(e)}"


async def _index_memory_best_effort(text: str, metadata: Dict[str, Any]) -> None:
    # Tie into L7/L22 path via Librarian embed (best effort, never blocks success)
    try:
        async with httpx.AsyncClient(timeout=6.0) as client:
            await client.post(
                "http://localhost:8888/librarian/embed",
                json={"text": _clip(text, 1200), "metadata": metadata},
            )
    except Exception:
        pass


async def _validate_with_l34(payload: Dict[str, Any], schema: str) -> tuple[bool, Optional[str]]:
    """Validate payload using L34 Validator (best effort)."""
    try:
        async with httpx.AsyncClient(timeout=4.0) as client:
            resp = await client.post(
                "http://localhost:8888/validator/validate",
                json={"data": payload, "schema": schema, "strict": True},
            )
            if resp.status_code != 200:
                return False, f"validator_http_{resp.status_code}"
            data = resp.json()
            valid = bool(data.get("valid"))
            if not valid:
                errs = data.get("errors") or []
                return False, f"validator_reject: {errs[:2]}"
            return True, None
    except Exception as e:
        return False, f"validator_unavailable: {str(e)[:80]}"


@router.get("/status")
async def academy_status():
    """L16: Academy status with real metrics and observability."""
    success_rate = round((_oracle_successes / max(1, _oracle_successes + _oracle_failures)) * 100, 1)
    return {
        "success": True,
        "level": 16,
        "name": "The Academy",
        "status": "active",
        "topics_learned": len(_topics_learned),
        "knowledge_entries": len(_knowledge_base),
        "patterns_stored": len(_patterns_stored),
        "recent_topics": list(_topics_learned.keys())[-10:],
        "oracle_calls": _oracle_calls,
        "oracle_successes": _oracle_successes,
        "oracle_failures": _oracle_failures,
        "oracle_success_rate_pct": success_rate,
        "oracle_consecutive_failures": _oracle_consecutive_failures,
        "oracle_breaker_open": (time.time() < _oracle_breaker_open_until),
        "oracle_breaker_seconds_remaining": max(0, int(_oracle_breaker_open_until - time.time())),
        "last_oracle_error": _last_oracle_error,
        "cache_hits": _cache_hits,
        "cache_misses": _cache_misses,
        "avg_learn_latency_ms": _mean(_learn_latency_ms[-50:]),
        "avg_teach_latency_ms": _mean(_teach_latency_ms[-50:]),
        "degraded": (_oracle_failures > _oracle_successes and _oracle_failures > 0),
        "capabilities": [
            "oracle_learning_modules",
            "knowledge_ingestion",
            "pattern_extraction",
            "assessment_generation",
            "provenance_tracking",
            "cache_acceleration",
            "memory_indexing",
        ],
    }


@router.post("/learn")
async def academy_learn(request: LearnRequest):
    """Learn a topic via Oracle-generated structured learning module."""
    global _oracle_failures, _oracle_successes, _last_oracle_error, _cache_hits, _cache_misses

    t0 = time.time()
    topic = _sanitize_text(request.topic)
    context = _sanitize_text(request.context or "") if request.context else None
    depth = request.depth or "intermediate"

    if not topic:
        return {"success": False, "error": "topic is required"}

    learn_payload = {"action": "academy_learn", "user_id": "academy_l16", "params": {"topic": topic, "depth": depth, "context": bool(context)}}
    valid, v_err = await _validate_with_l34(learn_payload, "user_request")
    if not valid:
        return {"success": False, "error": f"L34 validation failed: {v_err}"}

    ck = _cache_key(topic, depth, context)
    now = time.time()
    cached = _learn_cache.get(ck)
    if cached and (now - cached["ts"] <= CACHE_TTL_SECONDS):
        _cache_hits += 1
        _learn_latency_ms.append((time.time() - t0) * 1000)
        return {
            "success": True,
            "cached": True,
            "topic_id": cached["id"],
            "topic": topic,
            "depth": depth,
            "module": cached["module"],
            "oracle_error": None,
            "provenance": cached["provenance"],
            "timestamp": cached["learned_at"],
        }

    _cache_misses += 1
    topic_id = hashlib.md5(f"{topic}:{time.time()}".encode()).hexdigest()[:12]

    depth_instruction = {
        "beginner": "Assume no prior knowledge. Use simple language.",
        "intermediate": "Assume basic familiarity. Include some technical depth.",
        "advanced": "Assume strong background. Go deep into nuances and edge cases.",
    }.get(depth, "")

    context_extra = f"\nContext: {context}" if context else ""
    oracle_prompt = (
        f"You are a teaching AI. Create a structured learning module on: {topic}\n"
        f"Depth: {depth}. {depth_instruction}{context_extra}\n\n"
        f"Include:\n"
        f"1) Key concepts (3-5)\n"
        f"2) Common misconceptions (2-3)\n"
        f"3) Practice exercises (2-3)\n"
        f"4) Assessment questions (2-3)\n"
        f"Be structured and concise."
    )

    oracle_module, oracle_error = await _oracle_chat(oracle_prompt)
    _last_oracle_error = oracle_error

    provenance = {
        "source": "oracle_l5",
        "created_at": datetime.now().isoformat(),
        "confidence": 0.85 if oracle_module else 0.0,
        "depth": depth,
        "context_present": bool(context),
    }

    module_entry = {
        "id": topic_id,
        "topic": topic,
        "depth": depth,
        "module_content": oracle_module,
        "oracle_error": oracle_error,
        "learned_at": datetime.now().isoformat(),
        "context": context,
        "provenance": provenance,
    }
    _topics_learned[topic_id] = module_entry

    if oracle_error or not oracle_module:
        _oracle_failures += 1
        _learn_latency_ms.append((time.time() - t0) * 1000)
        return {
            "success": False,
            "cached": False,
            "topic_id": topic_id,
            "topic": topic,
            "depth": depth,
            "module": oracle_module,
            "oracle_error": oracle_error or "No Oracle module produced",
            "provenance": provenance,
            "timestamp": module_entry["learned_at"],
        }

    _oracle_successes += 1
    _learn_cache[ck] = {
        "id": topic_id,
        "module": oracle_module,
        "ts": time.time(),
        "learned_at": module_entry["learned_at"],
        "provenance": provenance,
    }

    await _index_memory_best_effort(
        f"L16 learned topic: {topic}",
        {"type": "academy_learn", "level": 16, "topic": topic, "depth": depth},
    )

    _learn_latency_ms.append((time.time() - t0) * 1000)
    return {
        "success": True,
        "cached": False,
        "topic_id": topic_id,
        "topic": topic,
        "depth": depth,
        "module": oracle_module,
        "oracle_error": None,
        "provenance": provenance,
        "timestamp": module_entry["learned_at"],
    }


@router.post("/teach")
async def academy_teach(request: TeachRequest):
    """Teach new content; extract patterns; index memory."""
    global _oracle_failures, _oracle_successes, _last_oracle_error

    t0 = time.time()
    content = _clip(_sanitize_text(request.content))
    tags = request.tags or []
    source = request.source or "user"

    if not content:
        return {"success": False, "error": "content is required"}

    teach_payload = {"action": "academy_teach", "user_id": "academy_l16", "params": {"content_len": len(content), "tags": len(tags), "source": source}}
    valid, v_err = await _validate_with_l34(teach_payload, "user_request")
    if not valid:
        return {"success": False, "error": f"L34 validation failed: {v_err}"}

    entry_id = hashlib.md5(f"teach:{time.time()}:{content[:50]}".encode()).hexdigest()[:12]

    kb_entry = {
        "id": entry_id,
        "content": content,
        "tags": tags,
        "source": source,
        "taught_at": datetime.now().isoformat(),
        "patterns": [],
        "provenance": {
            "source": source,
            "ingested_at": datetime.now().isoformat(),
            "sanitized": True,
            "max_chars": MAX_CONTENT_CHARS,
        },
    }

    oracle_prompt = (
        f"You are a knowledge analyst. Analyze the content and extract:\n"
        f"1) Key patterns/principles (2-5)\n"
        f"2) Relationships to other concepts\n"
        f"3) Actionable insights\n"
        f"4) Suggested tags\n\n"
        f"Content:\n{content}\n\n"
        f"User tags: {', '.join(tags) if tags else 'none'}"
    )

    oracle_patterns, oracle_error = await _oracle_chat(oracle_prompt)
    _last_oracle_error = oracle_error

    if oracle_patterns:
        pattern_entry = {
            "id": entry_id,
            "source_content_preview": content[:200],
            "extracted_patterns": oracle_patterns,
            "tags": tags,
            "extracted_at": datetime.now().isoformat(),
            "provenance": {"source": "oracle_l5", "confidence": 0.82},
        }
        _patterns_stored.append(pattern_entry)
        kb_entry["patterns"] = [oracle_patterns]

    _knowledge_base.append(kb_entry)

    if oracle_error or not oracle_patterns:
        _oracle_failures += 1
        _teach_latency_ms.append((time.time() - t0) * 1000)
        return {
            "success": False,
            "entry_id": entry_id,
            "content_length": len(content),
            "tags": tags,
            "patterns_extracted": oracle_patterns,
            "oracle_error": oracle_error or "No Oracle patterns produced",
            "knowledge_base_size": len(_knowledge_base),
            "timestamp": kb_entry["taught_at"],
        }

    _oracle_successes += 1

    await _index_memory_best_effort(
        f"L16 taught content ingested: {content[:120]}",
        {"type": "academy_teach", "level": 16, "tags": tags, "source": source},
    )

    _teach_latency_ms.append((time.time() - t0) * 1000)
    return {
        "success": True,
        "entry_id": entry_id,
        "content_length": len(content),
        "tags": tags,
        "patterns_extracted": oracle_patterns,
        "oracle_error": None,
        "knowledge_base_size": len(_knowledge_base),
        "timestamp": kb_entry["taught_at"],
    }


@router.get("/patterns")
async def academy_patterns():
    """Return all learned patterns from the knowledge base."""
    return {
        "success": True,
        "total_patterns": len(_patterns_stored),
        "total_knowledge_entries": len(_knowledge_base),
        "patterns": _patterns_stored[-50:],
        "all_tags": list(set(tag for entry in _knowledge_base for tag in entry.get("tags", []))),
    }
