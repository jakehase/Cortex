"""L7 Librarian adapter: principal-scoped durable recall.

Calls the live ``routers.librarian.robust_search`` in process with ONLY the
parameters its signature accepts (``query, n_results, allow_fallback,
tenant_id, workspace_id, memory_principal_key``).  The legacy
``ExecutionEngine._librarian_recall`` also passes ``file_memory_grant_key``,
which the live function rejects with ``TypeError`` -- this adapter does not.

Read-only; isolation is by ``memory_principal_key`` exactly as the OpenClaw
``memory_search`` path (``POST /knowledge/search``).  Never reports "no
memories" when the store itself was unavailable.
"""

from __future__ import annotations

import asyncio
import re
import time
from typing import Any, Dict, List, Mapping, Optional

from cortex_server.modules.execution_engine import ExecutionBlocked

LEVEL = 7
NAME = "librarian"
NEEDS_MODEL = False
SAFE_AUTORUN = True
DEFAULT_DEADLINE_S = 10.0

MAX_RESULTS = 8
DEFAULT_RESULTS = 6
MAX_TEXT_CHARS = 1200
MAX_SUMMARY_CHARS = 1500
_SCOPE_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$")
_METADATA_FIELDS = (
    "type",
    "memory_type",
    "source",
    "fact_key",
    "memory_status",
    "project",
    "observed_at",
    "recorded_at",
    "created_at",
    "timestamp",
)


def _scope_id(value: Any) -> Optional[str]:
    text = str(value or "").strip()
    return text if text and _SCOPE_ID_RE.fullmatch(text) else None


def _limit(context: Mapping[str, Any]) -> int:
    try:
        requested = int(context.get("memory_limit") or DEFAULT_RESULTS)
    except (TypeError, ValueError):
        requested = DEFAULT_RESULTS
    return max(1, min(requested, MAX_RESULTS))


def recall_kwargs(query: str, context: Mapping[str, Any]) -> Dict[str, Any]:
    """Build the exact keyword set passed to ``robust_search``.

    Exposed for tests that assert every key exists in the live signature.
    """

    principal = str(context.get("memory_principal_key") or "").strip()
    if not principal:
        raise ExecutionBlocked("authenticated_memory_scope_required")
    return {
        "query": query,
        "n_results": _limit(context),
        "allow_fallback": True,
        "tenant_id": _scope_id(context.get("tenant_id")),
        # /knowledge/search passes the principal's storage workspace; prefer it
        # when the caller supplies it.  Isolation itself is by principal key.
        "workspace_id": _scope_id(
            context.get("storage_workspace_id") or context.get("workspace_id")
        ),
        "memory_principal_key": principal,
    }


def _clip(text: Any, limit: int) -> str:
    text = str(text or "")
    return text if len(text) <= limit else text[: max(0, limit - 1)].rstrip() + "…"


def bounded_rows(rows: Any, limit: int) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for row in list(rows or [])[:limit]:
        if not isinstance(row, Mapping):
            continue
        metadata = row.get("metadata") if isinstance(row.get("metadata"), Mapping) else {}
        item: Dict[str, Any] = {
            "id": str(row.get("id") or ""),
            "text": _clip(row.get("text"), MAX_TEXT_CHARS),
        }
        distance = row.get("distance")
        if isinstance(distance, (int, float)):
            item["distance"] = round(float(distance), 4)
        # Only non-identifying descriptive metadata; principal/scope fields
        # (user_id, session_id, memory_principal_key, ...) are never echoed.
        for field in _METADATA_FIELDS:
            value = metadata.get(field)
            if value not in (None, "", [], {}):
                item[field] = _clip(value, 200) if isinstance(value, str) else value
        out.append(item)
    return out


async def run(query: str, context: Mapping[str, Any]) -> Dict[str, Any]:
    started = time.monotonic()
    text = str(query or "").strip()
    context = context or {}
    kwargs = recall_kwargs(text, context)
    if not text:
        raise ExecutionBlocked("empty_query")

    from cortex_server.routers.librarian import robust_search
    from cortex_server.runtime.memory_governance import MemoryGovernanceError

    try:
        result = await asyncio.to_thread(robust_search, **kwargs)
    except MemoryGovernanceError as exc:
        raise ExecutionBlocked("memory_governance_unavailable") from exc
    if not isinstance(result, Mapping):
        raise ExecutionBlocked("memory_search_invalid_result")
    rows = bounded_rows(result.get("results"), kwargs["n_results"])
    available = bool(result.get("available", True))
    if not rows and not available:
        # The store could not be read: do not present that as "no memories".
        raise ExecutionBlocked("memory_store_unavailable")

    search_mode = str(result.get("search_mode") or "unknown")
    degraded = bool(result.get("degraded", False))
    warning = result.get("warning")
    header = (
        f"Principal-scoped memory recall ({search_mode}"
        + (", degraded" if degraded else "")
        + f"): {len(rows)} result(s)."
    )
    lines = [header]
    for index, row in enumerate(rows, start=1):
        label = f" [{row['fact_key']}]" if row.get("fact_key") else ""
        status = f" ({row['memory_status']})" if row.get("memory_status") not in (None, "active") else ""
        lines.append(f"{index}.{label}{status} {_clip(row['text'], 240)}")
    if not rows:
        lines.append("No stored memories matched this message for this principal.")
    return {
        "operation": "librarian.recall",
        "origin": "deterministic",
        "summary": _clip("\n".join(lines), MAX_SUMMARY_CHARS),
        "data": {
            "search_mode": search_mode,
            "degraded": degraded,
            "available": available,
            "warning": _clip(warning, 300) if warning else None,
            "results": rows,
            "sources": [row["id"] for row in rows if row.get("id")],
        },
        "elapsed_ms": int((time.monotonic() - started) * 1000),
    }
