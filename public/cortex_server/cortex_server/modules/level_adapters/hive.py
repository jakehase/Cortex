"""ExecutionEngine adapter for L12 Hive: model decomposition + read-only fan-out.

Runs one bounded swarm (at most ``MAX_SUBTASKS`` subtasks, three in parallel,
per-subtask timeout) over READ-ONLY level adapters only (librarian, mnemosyne,
ghost when it is marked safe for autorun).  It never sends messages, writes user
files, executes code or schedules work.
"""

from __future__ import annotations

from typing import Any, Dict, Mapping

from cortex_server.modules import hive_swarm
from cortex_server.modules.execution_engine import ExecutionBlocked

LEVEL = 12
NAME = "hive"
NEEDS_MODEL = True
SAFE_AUTORUN = True  # read-only sub-adapters only; bounded subtasks and deadline
DEFAULT_DEADLINE_S = 95.0
ADAPTER_MAX_SUBTASKS = 3


async def run(query: str, context: Mapping[str, Any]) -> Dict[str, Any]:
    ctx = dict(context or {})
    scope = str(ctx.get("principal_scope_key") or "").strip()
    if not scope:
        raise ExecutionBlocked("missing_principal_scope")
    if not str(query or "").strip():
        raise ExecutionBlocked("empty_query")
    if ctx.get("parent_level") == "hive":
        raise ExecutionBlocked("recursive_hive_invocation")
    if ctx.get("oracle_brief"):
        ctx["hive_context"] = f"Oracle brief for this turn: {str(ctx['oracle_brief'])[:1200]}"
    result = await hive_swarm.run_swarm(
        query,
        context=ctx,
        max_subtasks=ADAPTER_MAX_SUBTASKS,
        deadline_s=DEFAULT_DEADLINE_S - 5.0,
    )
    status = str(result.get("status") or "")
    subtasks = [
        {
            "id": row.get("id"),
            "question": str(row.get("question") or "")[:200],
            "level": row.get("level"),
            "status": row.get("status"),
            "latency_ms": row.get("latency_ms"),
            "reason": row.get("reason"),
            "excerpt": str(row.get("excerpt") or "")[:400],
        }
        for row in (result.get("subtasks") or [])[: hive_swarm.MAX_SUBTASKS]
    ]
    if status != "completed":
        if not subtasks:
            raise ExecutionBlocked(status or "model_unavailable")
        # Subtasks ran (real evidence) but there is no model synthesis.
        succeeded = [s for s in subtasks if s["status"] == "succeeded"]
        if not succeeded:
            raise ExecutionBlocked(status or "no_subtask_evidence")
        return {
            "operation": "hive.run",
            "origin": "deterministic",
            "summary": (
                "Hive could not synthesise (" + status + "); raw read-only subtask evidence: "
                + " | ".join(f"[{s['id']}] {s['excerpt'][:250]}" for s in succeeded)
            )[:1500],
            "data": {"status": status, "subtasks": subtasks, "synthesis": None},
            "elapsed_ms": result.get("elapsed_ms"),
        }
    synthesis = result.get("synthesis") or {}
    gaps = synthesis.get("gaps") or []
    summary = str(synthesis.get("answer") or "")
    if synthesis.get("citations"):
        summary += f" [sources: {', '.join(synthesis['citations'])}]"
    if gaps:
        summary += " Gaps: " + "; ".join(gaps[:3])
    return {
        "operation": "hive.run",
        "origin": "model",
        "summary": summary[:1500],
        "data": {
            "status": status,
            "subtasks": subtasks,
            "synthesis": {
                "answer": str(synthesis.get("answer") or "")[:1200],
                "citations": synthesis.get("citations") or [],
                "gaps": gaps[:6],
                "confidence": synthesis.get("confidence"),
            },
            "run_id": result.get("run_id"),
        },
        "model": result.get("model"),
        "receipt_id": result.get("receipt_id"),
        "elapsed_ms": result.get("elapsed_ms"),
    }
