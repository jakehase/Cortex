"""Q&A Fastlane v1 micro retrieval."""
from __future__ import annotations

from typing import List, Dict, Any
import time


def retrieve_top3(query: str, max_items: int = 3, timeout_ms: int = 350) -> List[Dict[str, Any]]:
    start = time.time()
    cap = max(1, min(max_items, 3))

    recent_memory = [{"source": "recent_memory", "snippet": f"Recent context for: {query}"}]
    curated_memory = [{"source": "curated_memory", "snippet": f"Curated note for: {query}"}]
    docs_snippets = [{"source": "docs", "snippet": f"Docs snippet for: {query}"}]

    merged = recent_memory + curated_memory + docs_snippets
    out: List[Dict[str, Any]] = []
    for item in merged:
        if (time.time() - start) * 1000 > timeout_ms:
            break
        out.append(item)
        if len(out) >= cap:
            break
    return out
