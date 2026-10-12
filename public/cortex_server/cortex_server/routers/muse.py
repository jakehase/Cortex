"""L29 Muse — creative inspiration + brainstorming (model-backed).

- Every result is produced by a receipt-verified model call through
  ``modules.level_model`` (in-process OpenClaw lane, principal-scoped,
  ephemeral session). No unauthenticated HTTP hop to ``/oracle/chat``.
- Strict output schemas: /inspire ``{title?, content}``; /brainstorm exactly 5/3/1.
- Fails closed: when the model is unavailable or its output does not fit the
  schema the response is ``success: false`` with ``origin: model_unavailable``
  and empty content. Never canned creative text.
- ``/status`` reports measured health from recent real calls.
"""

from __future__ import annotations

from typing import Dict, List, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from cortex_server.modules import muse as muse_core
from cortex_server.modules.level_router_support import (
    model_lane_readiness,
    principal_scope_for_request,
)

router = APIRouter(tags=["muse"])

MAX_TOPIC_CHARS = muse_core.MAX_TOPIC_CHARS
MAX_PROBLEM_CHARS = muse_core.MAX_PROBLEM_CHARS
MAX_CONTEXT_CHARS = muse_core.MAX_CONTEXT_CHARS
Style = muse_core.Style


class InspireRequest(BaseModel):
    topic: str = Field(..., min_length=1, max_length=MAX_TOPIC_CHARS)
    style: Optional[Style] = "brainstorm"
    context: Optional[str] = Field(None, max_length=MAX_CONTEXT_CHARS)


class InspireResponse(BaseModel):
    success: bool
    topic: str
    style: str
    content: str
    title: Optional[str] = None
    error: Optional[str] = None
    origin: str = "model_unavailable"
    operation: str = "muse.inspire"
    model: Optional[str] = None
    receipt_id: Optional[str] = None
    model_status: Optional[str] = None
    elapsed_ms: Optional[int] = None
    label: Optional[str] = None


class BrainstormRequest(BaseModel):
    problem: str = Field(..., min_length=1, max_length=MAX_PROBLEM_CHARS)
    context: Optional[str] = Field(None, max_length=MAX_CONTEXT_CHARS)


class BrainstormResponse(BaseModel):
    success: bool
    problem: str
    conventional: List[Dict[str, str]]
    unconventional: List[Dict[str, str]]
    moonshot: Optional[Dict[str, str]] = None
    raw_response: Optional[str] = None
    error: Optional[str] = None
    origin: str = "model_unavailable"
    operation: str = "muse.brainstorm"
    model: Optional[str] = None
    receipt_id: Optional[str] = None
    model_status: Optional[str] = None
    elapsed_ms: Optional[int] = None
    label: Optional[str] = None


def _response_fields(model_cls: type[BaseModel], payload: dict) -> dict:
    return {k: v for k, v in payload.items() if k in model_cls.model_fields}


@router.get("/status")
async def muse_status():
    lane = model_lane_readiness()
    outcomes = muse_core.OUTCOMES.snapshot()
    counts = muse_core.counters()
    return {
        "success": True,
        "level": 29,
        "name": "Muse",
        "status": muse_core.OUTCOMES.health(lane),
        "model_backed": True,
        "model_lane": lane,
        "recent_outcomes": outcomes,
        "creations_count": counts["creations"],
        "errors_count": counts["errors"],
        "last_error": outcomes["last_error"],
        "limits": {
            "max_topic_chars": MAX_TOPIC_CHARS,
            "max_problem_chars": MAX_PROBLEM_CHARS,
            "max_context_chars": MAX_CONTEXT_CHARS,
            "model_deadline_s": muse_core.MUSE_DEADLINE_S,
        },
        "capabilities": ["creative_writing", "ideation", "brainstorming"],
    }


@router.post("/inspire", response_model=InspireResponse)
async def inspire(request: InspireRequest, http_request: Request = None):  # type: ignore[assignment]
    scope = principal_scope_for_request(http_request, muse_core.NAME)
    try:
        payload = await muse_core.inspire(
            request.topic,
            request.style or "brainstorm",
            principal_scope_key=scope,
            context=request.context,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return InspireResponse(**_response_fields(InspireResponse, payload))


@router.post("/brainstorm", response_model=BrainstormResponse)
async def brainstorm(request: BrainstormRequest, http_request: Request = None):  # type: ignore[assignment]
    scope = principal_scope_for_request(http_request, muse_core.NAME)
    try:
        payload = await muse_core.brainstorm(
            request.problem,
            principal_scope_key=scope,
            context=request.context,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return BrainstormResponse(**_response_fields(BrainstormResponse, payload))
