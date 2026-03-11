"""Q&A Fastlane v1 micro retrieval.

Adds lightweight automatic reranking by source trust + lexical relevance.
"""
from __future__ import annotations

from typing import List, Dict, Any
import re
import time


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


def retrieve_top3(query: str, max_items: int = 3, timeout_ms: int = 350) -> List[Dict[str, Any]]:
    start = time.time()
    cap = max(1, min(max_items, 3))

    candidates = [
        {
            "source": "recent_memory",
            "snippet": f"Recent context for: {query}",
            "freshness": 0.98,
        },
        {
            "source": "curated_memory",
            "snippet": f"Curated note for: {query}",
            "freshness": 0.90,
        },
        {
            "source": "docs",
            "snippet": f"Docs snippet for: {query}",
            "freshness": 0.75,
        },
    ]

    ranked: List[Dict[str, Any]] = []
    for item in candidates:
        if (time.time() - start) * 1000 > timeout_ms:
            break
        row = dict(item)
        row["score"] = _score_item(query, row)
        ranked.append(row)

    ranked.sort(key=lambda x: float(x.get("score", 0.0)), reverse=True)
    out = ranked[:cap]
    return out
