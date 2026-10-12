"""L22 Mnemosyne adapter: read-only structured-memory (fact) recall.

Where L7 returns ranked memory passages, L22 returns the *structured* view of
the principal's memory: typed facts with their fact/claim keys, temporal-truth
fields (valid_from/valid_until/observed_at), lifecycle status, and the current
fact-conflict projection (which record is the active winner for each claim).

Uses existing read functions only:
* ``routers.librarian.robust_search`` (same principal-scoped retrieval as
  ``/knowledge/search``; only parameters its live signature accepts), and
* ``runtime.memory_governance.MemoryGovernanceStore.conflict_projection``
  (the read behind ``POST /l22/facts/conflicts``) for the returned ids, which
  are already restricted to this principal.

No writes.  The knowledge/entity graph is not consulted: it is not populated
from memories (see ``/knowledge/status`` ``unavailable_capabilities``).
"""

from __future__ import annotations

import asyncio
import time
from typing import Any, Dict, List, Mapping

from cortex_server.modules.execution_engine import ExecutionBlocked
from cortex_server.modules.level_adapters.librarian import recall_kwargs

LEVEL = 22
NAME = "mnemosyne"
NEEDS_MODEL = False
SAFE_AUTORUN = True
DEFAULT_DEADLINE_S = 10.0

MAX_TEXT_CHARS = 400
MAX_SUMMARY_CHARS = 1500
MAX_EDGES = 5
_STRUCTURED_FIELDS = (
    "fact_key",
    "claim_key",
    "subject",
    "predicate",
    "fact_value",
    "memory_type",
    "type",
    "memory_status",
    "fact_status",
    "valid_from",
    "valid_until",
    "valid_time_state",
    "observed_at",
    "recorded_at",
    "known_at",
    "verified_at",
    "superseded_by",
    "project",
    "classification",
    "tags",
)


def _clip(text: Any, limit: int) -> str:
    text = str(text or "")
    return text if len(text) <= limit else text[: max(0, limit - 1)].rstrip() + "…"


def _structured_row(row: Mapping[str, Any]) -> Dict[str, Any]:
    metadata = row.get("metadata") if isinstance(row.get("metadata"), Mapping) else {}
    item: Dict[str, Any] = {
        "id": str(row.get("id") or ""),
        "text": _clip(row.get("text"), MAX_TEXT_CHARS),
    }
    for field in _STRUCTURED_FIELDS:
        value = metadata.get(field)
        if value in (None, "", [], {}):
            continue
        if isinstance(value, str):
            value = _clip(value, 200)
        elif isinstance(value, (list, tuple)):
            value = [_clip(v, 80) for v in list(value)[:10]]
        elif not isinstance(value, (int, float, bool)):
            value = _clip(value, 200)
        item[field] = value
    return item


def _conflict_projection(principal_key: str, ids: List[str]) -> Dict[str, Any]:
    from cortex_server.runtime.memory_governance import MemoryGovernanceStore

    return MemoryGovernanceStore().conflict_projection(
        principal_key=principal_key,
        memory_ids=ids,
    )


async def run(query: str, context: Mapping[str, Any]) -> Dict[str, Any]:
    started = time.monotonic()
    text = str(query or "").strip()
    context = context or {}
    kwargs = recall_kwargs(text, context)
    if not text:
        raise ExecutionBlocked("empty_query")
    principal = kwargs["memory_principal_key"]

    from cortex_server.routers.librarian import robust_search
    from cortex_server.runtime.memory_governance import MemoryGovernanceError

    try:
        result = await asyncio.to_thread(robust_search, **kwargs)
    except MemoryGovernanceError as exc:
        raise ExecutionBlocked("memory_governance_unavailable") from exc
    if not isinstance(result, Mapping):
        raise ExecutionBlocked("memory_search_invalid_result")
    raw_rows = [row for row in list(result.get("results") or []) if isinstance(row, Mapping)]
    raw_rows = raw_rows[: kwargs["n_results"]]
    available = bool(result.get("available", True))
    if not raw_rows and not available:
        raise ExecutionBlocked("memory_store_unavailable")

    rows = [_structured_row(row) for row in raw_rows]
    facts = [row for row in rows if row.get("fact_key") or row.get("claim_key")]
    others = [row for row in rows if not (row.get("fact_key") or row.get("claim_key"))]

    projection_status = "not_needed"
    if facts:
        try:
            projection = await asyncio.to_thread(
                _conflict_projection, principal, [row["id"] for row in facts if row["id"]]
            )
            projection_status = "ok"
        except Exception as exc:  # read-side projection is optional detail
            projection = {}
            projection_status = f"unavailable:{type(exc).__name__}"
        for row in facts:
            record = projection.get(row["id"]) if isinstance(projection, Mapping) else None
            if not isinstance(record, Mapping):
                continue
            row["effective_fact_status"] = record.get("fact_status")
            row["active_winner_id"] = record.get("active_winner_id")
            edges = list(record.get("edges") or [])
            row["conflict_edges"] = [
                {
                    "edge_type": edge.get("edge_type"),
                    "from_memory_id": edge.get("from_memory_id"),
                    "to_memory_id": edge.get("to_memory_id"),
                }
                for edge in edges[:MAX_EDGES]
                if isinstance(edge, Mapping)
            ]
            row["conflict_edge_count"] = len(edges)

    conflicted = [row for row in facts if row.get("effective_fact_status") == "conflicted"]
    lines = [
        f"Structured memory for this principal ({result.get('search_mode') or 'unknown'}"
        + (", degraded" if result.get("degraded") else "")
        + f"): {len(facts)} fact record(s)"
        + (f", {len(conflicted)} conflicted" if conflicted else "")
        + f", {len(others)} other memory record(s)."
    ]
    for row in facts:
        status = row.get("effective_fact_status") or row.get("memory_status") or "unknown"
        statement = " ".join(
            str(row[k]) for k in ("subject", "predicate", "fact_value") if row.get(k)
        ) or _clip(row["text"], 200)
        validity = ""
        if row.get("valid_from") or row.get("valid_until"):
            validity = f" valid {row.get('valid_from') or '?'}→{row.get('valid_until') or 'now'}"
        winner = ""
        if status == "conflicted" and row.get("active_winner_id"):
            winner = f" (active winner: {row['active_winner_id']})"
        lines.append(f"- [{row.get('fact_key') or row.get('claim_key')}] {statement} — {status}{validity}{winner}")
    if not facts and others:
        lines.append("No structured fact records matched; related unstructured memories:")
        for row in others[:3]:
            lines.append(f"- {_clip(row['text'], 200)}")
    if not rows:
        lines.append("No stored memories matched this message for this principal.")
    return {
        "operation": "mnemosyne.recall",
        "origin": "deterministic",
        "summary": _clip("\n".join(lines), MAX_SUMMARY_CHARS),
        "data": {
            "search_mode": result.get("search_mode"),
            "degraded": bool(result.get("degraded", False)),
            "available": available,
            "fact_projection": projection_status,
            "facts": facts,
            "other_memories": others,
            "sources": [row["id"] for row in rows if row.get("id")],
        },
        "elapsed_ms": int((time.monotonic() - started) * 1000),
    }
