"""Q&A Fastlane v1 micro retrieval.

This module only ranks evidence supplied by a real retrieval backend.  It must
never manufacture query-shaped snippets: an empty candidate set means that the
fastlane has no grounding and its caller must escalate.
"""
from __future__ import annotations

import re
import time
from typing import Any, Dict, List, Optional


SOURCE_PRIOR = {
    "curated_memory": 0.95,
    "recent_memory": 0.90,
    "docs": 0.85,
}


def _tokenize(text: str) -> List[str]:
    return [t for t in re.findall(r"[a-z0-9]+", (text or "").lower()) if len(t) > 1]


def _relevance(query: str, snippet: str) -> float:
    q_tokens = set(_tokenize(query))
    s_tokens = set(_tokenize(snippet))
    if not q_tokens:
        return 0.0
    overlap = len(q_tokens & s_tokens)
    return min(1.0, overlap / max(1, len(q_tokens)))


def _score_item(query: str, item: Dict[str, Any]) -> float:
    source = str(item.get("source", ""))
    prior = SOURCE_PRIOR.get(source, 0.75)
    rel = _relevance(query, str(item.get("snippet", "")))
    freshness = float(item.get("freshness", 0.7))
    return round((0.50 * rel) + (0.30 * prior) + (0.20 * freshness), 4)


def _normalized_candidate(query: str, item: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Return a grounded candidate or reject untraceable/query-echo evidence."""
    if not isinstance(item, dict):
        return None
    source = str(item.get("source") or "").strip()
    snippet = re.sub(r"\s+", " ", str(item.get("snippet") or "")).strip()
    provenance = str(
        item.get("provenance")
        or item.get("url")
        or item.get("memory_id")
        or item.get("document_id")
        or ""
    ).strip()
    if not source or not snippet or not provenance:
        return None

    query_tokens = set(_tokenize(query))
    snippet_tokens = set(_tokenize(snippet))
    independent_tokens = snippet_tokens - query_tokens
    # Generic wrappers around the query are not evidence, even if a caller
    # labels them as memory or documentation.
    if query_tokens and query_tokens.issubset(snippet_tokens) and len(independent_tokens) <= 3:
        return None

    try:
        freshness = max(0.0, min(1.0, float(item.get("freshness", 0.7))))
    except (TypeError, ValueError):
        freshness = 0.7
    return {
        "source": source[:80],
        "snippet": snippet[:1200],
        "freshness": freshness,
        "provenance": provenance[:500],
        "grounded": True,
    }


def retrieve_top3(
    query: str,
    max_items: int = 3,
    timeout_ms: int = 350,
    *,
    candidates: Optional[List[Dict[str, Any]]] = None,
) -> List[Dict[str, Any]]:
    start = time.time()
    cap = max(1, min(max_items, 3))

    ranked: List[Dict[str, Any]] = []
    for item in candidates or []:
        if (time.time() - start) * 1000 > timeout_ms:
            break
        row = _normalized_candidate(query, item)
        if row is None:
            continue
        row["score"] = _score_item(query, row)
        ranked.append(row)

    ranked.sort(key=lambda x: float(x.get("score", 0.0)), reverse=True)
    out = ranked[:cap]
    return out
