"""ExecutionEngine adapter for L16 Academy.

Pasted material (> 400 chars) is run through evidence-checked pattern
extraction; otherwise the message is treated as a topic to learn. The adapter
never persists anything (persistence happens only on an explicit
``POST /academy/teach`` / ``/academy/learn``).
"""

from __future__ import annotations

import re
from typing import Any, Dict, Mapping

from cortex_server.modules import academy as academy_core
from cortex_server.modules.execution_engine import ExecutionBlocked

LEVEL = 16
NAME = "academy"
NEEDS_MODEL = True
SAFE_AUTORUN = True  # pure model calls; persist=False
DEFAULT_DEADLINE_S = 80.0

_EXTRACT_MIN_CHARS = 400
_BEGINNER = re.compile(r"\b(beginner|basics?|eli5|simple terms|new to|intro(duction)?)\b", re.I)
_ADVANCED = re.compile(r"\b(advanced|in depth|in-depth|deep dive|expert|rigorous|edge cases)\b", re.I)


def _depth(text: str) -> str:
    if _BEGINNER.search(text):
        return "beginner"
    if _ADVANCED.search(text):
        return "advanced"
    return "intermediate"


async def run(query: str, context: Mapping[str, Any]) -> Dict[str, Any]:
    scope = str((context or {}).get("principal_scope_key") or "").strip()
    if not scope:
        raise ExecutionBlocked("missing_principal_scope")
    text = academy_core.sanitize_text(query)
    if not text:
        raise ExecutionBlocked("empty_query")

    if len(text) > _EXTRACT_MIN_CHARS:
        result = await academy_core.teach(text, principal_scope_key=scope, source="turn", persist=False)
        if not result.get("success"):
            raise ExecutionBlocked(str(result.get("status") or result.get("error") or "model_unavailable"))
        patterns = result["patterns_extracted"][:5]
        lines = [f"- {p['statement']} (evidence: \"{p['evidence_quote'][:120]}\")" for p in patterns]
        summary = "Patterns in the supplied material (each quote verified verbatim):\n" + "\n".join(lines)
        if result.get("insights"):
            summary += "\nInsights: " + "; ".join(result["insights"][:3])
        return {
            "operation": "academy.extract",
            "origin": "model",
            "summary": summary[:1500],
            "data": {"mode": "extract", "patterns": patterns, "insights": result.get("insights", [])[:5],
                     "evidence": result.get("evidence"), "truncated": result.get("truncated", False)},
            "model": result.get("model"),
            "receipt_id": result.get("receipt_id"),
        }

    result = await academy_core.learn(text, principal_scope_key=scope, depth=_depth(text), persist=False)
    if not result.get("success"):
        raise ExecutionBlocked(str(result.get("status") or "model_unavailable"))
    module = result["module"]
    concepts = "; ".join(f"{c['name']}: {c['explanation'][:160]}" for c in module.get("key_concepts", [])[:5])
    summary = f"{module.get('summary', '')} Key concepts — {concepts}"
    if module.get("sources_needed"):
        summary += " (Academy flags that authoritative sources are needed.)"
    return {
        "operation": "academy.learn",
        "origin": "model",
        "summary": summary[:1500],
        "data": {"mode": "learn", "depth": result.get("depth"), "module": module, "cached": result.get("cached", False)},
        "model": result.get("model"),
        "receipt_id": result.get("receipt_id"),
    }
