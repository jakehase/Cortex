"""ExecutionEngine adapter for L8 Cron: schedule PROPOSALS only.

Turns the user's message into a proposed cron job (deterministic parsing for
exact phrasings, model-backed parsing otherwise) with the next fire times
computed by the same APScheduler trigger the job would use.  It never
schedules anything: ``POST /cron/schedule`` still needs explicit user
confirmation and a single-use action capability.
"""

from __future__ import annotations

from typing import Any, Dict, Mapping

from cortex_server.modules import cron_tasks
from cortex_server.modules.execution_engine import ExecutionBlocked

LEVEL = 8
NAME = "cron"
NEEDS_MODEL = True  # only when deterministic parsing is not exact
SAFE_AUTORUN = True  # proposal only; no scheduling side effects
DEFAULT_DEADLINE_S = 50.0


async def run(query: str, context: Mapping[str, Any]) -> Dict[str, Any]:
    text = str(query or "").strip()
    if not text:
        raise ExecutionBlocked("empty_query")
    from cortex_server.scheduler import preview_fire_times, validate_timezone_name

    ctx = dict(context or {})
    scope = str(ctx.get("principal_scope_key") or "").strip()
    tz = str(ctx.get("timezone") or "").strip() or None
    if tz:
        try:
            tz = validate_timezone_name(tz)
        except ValueError:
            tz = None
    result = await cron_tasks.propose_schedule(
        text,
        timezone_name=tz,
        principal_scope_key=scope,
        use_model=bool(scope),
        preview_fn=preview_fire_times,
        validate_timezone_fn=validate_timezone_name,
    )
    status = str(result.get("status") or "")
    origin = str(result.get("origin") or "deterministic")
    if origin == "model_unavailable":
        raise ExecutionBlocked(status or "model_unavailable")
    meta = {k: result.get(k) for k in ("model", "receipt_id", "elapsed_ms") if result.get(k) is not None}
    if status == "proposed":
        proposal = result["proposal"]
        fires = ", ".join(proposal.get("next_fire_times", [])[:3])
        args = proposal.get("args") or []
        what = f"reminder '{args[0]}'" if args else proposal["task"]
        summary = (
            f"PROPOSAL ONLY (nothing scheduled): {what} on cron '{proposal['cron']}' "
            f"({proposal['timezone']}); next fires: {fires or 'n/a'}. Scheduling requires the user's explicit "
            "confirmation and POST /cron/schedule with an action capability. Reminders are recorded in Cortex; "
            "they do not send messages."
        )
        return {
            "operation": "cron.propose",
            "origin": origin,
            "summary": summary[:1500],
            "data": {
                "status": status,
                "proposal": proposal,
                "requires_confirmation": True,
                "scheduled": False,
                "notes": result.get("notes") or [],
            },
            **meta,
        }
    if status == "not_schedulable":
        return {
            "operation": "cron.propose",
            "origin": origin,
            "summary": (
                "Cron cannot run this as a scheduled Cortex task"
                + (" (it is a one-off request)" if result.get("one_off") else "")
                + f": {result.get('reason') or 'unsupported action'}. Supported scheduled tasks: reminder log, "
                "health report."
            )[:1500],
            "data": {"status": status, "scheduled": False, "one_off": bool(result.get("one_off"))},
            **meta,
        }
    if status == "incomplete":
        missing = result.get("missing") or [k for k in ("cron", "task") if not (result.get("parsed") or {}).get(k)]
        return {
            "operation": "cron.propose",
            "origin": origin,
            "summary": (
                "No exact schedule could be derived; missing: " + ", ".join(missing or ["details"])
                + ". Ask the user for the exact recurrence and time."
            )[:1500],
            "data": {"status": status, "parsed": result.get("parsed"), "scheduled": False},
            **meta,
        }
    raise ExecutionBlocked(status or "proposal_failed")
