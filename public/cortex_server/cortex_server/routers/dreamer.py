"""Level 13: Dreamer — gap analysis, scenarios and improvement discovery (model-backed).

- ``POST /dreamer/dream`` runs a receipt-verified model call through
  ``modules.level_model`` and returns strict JSON: gaps (with evidence and the
  source that evidence came from), scenarios, improvements (each with a first
  step) and assumptions. Only evidence sources actually supplied are accepted.
- Optional ``include_system_gaps`` adds redacted excerpts from the Cortex event
  ledger. It needs the global admin credential AND the existing
  ``evolution.dream`` execution capability with the log path inside the
  configured execution roots (the same allowlist ``/evolution/dream`` uses).
- On model failure: ``success: false``, ``origin: model_unavailable``, no
  ideas. Dreams are persisted per principal (JSONL, or memory if the state
  directory is not writable — reported in ``/status``).
- ``/status`` reports measured state; no hard-coded capability flags.
"""

from __future__ import annotations

from pathlib import Path
from typing import Annotated, Any, List, Optional

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field

from cortex_server.modules import dreamer as dreamer_core
from cortex_server.modules.level_router_support import (
    is_global_admin,
    model_lane_readiness,
    principal_scope_for_request,
)

router = APIRouter()


class DreamRequest(BaseModel):
    topic: str = Field(..., min_length=1, max_length=dreamer_core.MAX_TOPIC_CHARS)
    context: Optional[str] = Field(None, max_length=dreamer_core.MAX_CONTEXT_CHARS)
    include_system_gaps: bool = False


def _log_source_present() -> bool:
    try:
        return dreamer_core.Dreamer().log_path.exists()
    except Exception:
        return False


@router.get("/status")
async def dreamer_status(http_request: Request = None):  # type: ignore[assignment]
    """L13 status from measured state (model outcomes, store, log source)."""

    lane = model_lane_readiness()
    store = dreamer_core.get_store()
    scope = principal_scope_for_request(http_request, dreamer_core.NAME)
    stats = store.stats(scope)
    counts = dreamer_core.counters()
    return {
        "success": True,
        "data": {
            "level": 13,
            "name": "The Dreamer",
            "role": "Gap analysis, creative scenarios, and improvement discovery",
            "status": dreamer_core.OUTCOMES.health(lane),
            "model_backed": True,
            "model_lane": lane,
            "recent_outcomes": dreamer_core.OUTCOMES.snapshot(),
            "dreams_generated": counts["dreams"],
            "dream_errors": counts["errors"],
            "persistence": stats["mode"],
            "dreams_persisted": stats["dreams_persisted"],
            "last_dream_at": stats["last_dream_at"],
            "has_latest": stats["dreams_persisted"] > 0,
            "log_source_present": _log_source_present(),
            "system_gap_evidence": "admin + evolution.dream execution capability required",
            "auto_dream_enabled": False,
        },
    }


@router.get("/dreams")
async def get_dreams(
    http_request: Request = None,  # type: ignore[assignment]
    limit: Annotated[int, Query(ge=1, le=50)] = 10,
):
    """Persisted dreams for the calling principal only (newest last)."""

    scope = principal_scope_for_request(http_request, dreamer_core.NAME)
    dreams = dreamer_core.get_store().list(scope, limit)
    return {"success": True, "count": len(dreams), "dreams": dreams}


def _system_evidence(http_request: Any) -> List[str]:
    """Redacted ledger excerpts, gated exactly like /evolution/dream's log read."""

    if not is_global_admin(http_request):
        raise HTTPException(
            status_code=403,
            detail={"error": "admin_required", "message": "include_system_gaps requires the global admin credential"},
        )
    from cortex_server.modules.execution_capabilities import (
        ExecutionCapabilityDenied,
        authorize_execution_request,
        resolve_authorized_path,
    )

    scanner = dreamer_core.Dreamer()
    try:
        grant = authorize_execution_request(http_request, "evolution.dream")
        if not scanner.log_path.exists():
            return []
        resolve_authorized_path(
            grant, "evolution.dream", Path(scanner.log_path).resolve(strict=False), require_file=True
        )
    except ExecutionCapabilityDenied as exc:
        raise HTTPException(
            status_code=exc.status_code,
            detail={"error": exc.code, "message": exc.detail, "action": "evolution.dream"},
        ) from exc
    scanner.scan_logs()
    return scanner.evidence_excerpts()


@router.post("/dream")
async def create_dream(
    http_request: Request = None,  # type: ignore[assignment]
    body: Optional[DreamRequest] = None,
    scenario: Annotated[Optional[str], Query(max_length=dreamer_core.MAX_TOPIC_CHARS)] = None,
):
    """Model-backed gap analysis / scenarios / improvements for a topic.

    Accepts a JSON body ``{topic, context?, include_system_gaps?}``; the legacy
    ``?scenario=`` query parameter is still accepted as the topic.
    """

    topic = (body.topic if body else None) or (scenario or "")
    if not topic.strip():
        raise HTTPException(status_code=422, detail="topic (JSON body) or scenario (query) is required")
    context = body.context if body else None
    evidence: List[str] = []
    if body is not None and body.include_system_gaps:
        evidence = _system_evidence(http_request)

    scope = principal_scope_for_request(http_request, dreamer_core.NAME)
    try:
        payload = await dreamer_core.dream(
            topic, principal_scope_key=scope, context=context, system_evidence=evidence
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    if not payload.get("success"):
        return payload
    record = dreamer_core.persist_dream(payload, scope=scope)
    return {
        **payload,
        "dream": record,
        "include_system_gaps": bool(body and body.include_system_gaps),
    }
