"""
Seer Router - API endpoints for L30 Seer (model-backed forecasting).

- Forecasts come from a receipt-verified model call through
  ``modules.level_model`` (in-process OpenClaw lane, principal-scoped,
  ephemeral session). The unauthenticated HTTP hop to ``/oracle/chat`` is gone.
- Strict schemas (exact counts, enum fields). An out-of-schema answer gets one
  model repair attempt, then fails closed. No padding, no templated
  risks/opportunities/trends, no invented "observed" evidence.
- On timeout / model error / invalid output: ``success: false``,
  ``origin: model_unavailable``, empty lists. This is the only fallback.
- ``/status`` reports measured health from recent real calls.
"""

from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from cortex_server.modules import seer as seer_core
from cortex_server.modules.level_router_support import (
    model_lane_readiness,
    principal_scope_for_request,
)
from cortex_server.modules.provider_result import ProviderResultEnvelope

router = APIRouter()

SEER_DEADLINE_S = seer_core.SEER_DEADLINE_S


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------


class EvidenceItem(BaseModel):
    source: str = Field("unspecified", max_length=200)
    text: str = Field(..., min_length=1, max_length=seer_core.MAX_EVIDENCE_CHARS)


class PredictRequest(BaseModel):
    """Scenario for risk/opportunity analysis."""

    scenario: str = Field(..., min_length=1, max_length=seer_core.MAX_SCENARIO_CHARS)
    time_horizon: Optional[str] = Field("6 months", max_length=64)
    context: Optional[str] = Field(None, max_length=seer_core.MAX_CONTEXT_CHARS)
    evidence: Optional[List[EvidenceItem]] = Field(None, max_length=seer_core.MAX_EVIDENCE_ITEMS)


class RiskItem(BaseModel):
    risk: str
    severity: str
    likelihood: str
    mitigation: str


class OpportunityItem(BaseModel):
    opportunity: str
    impact: str
    difficulty: str
    action: str


class _SeerEnvelope(ProviderResultEnvelope):
    # Widened from ProviderResultEnvelope's literal: "model" on success,
    # "model_unavailable" on any failure.
    origin: str = "model_unavailable"
    operation: str = ""
    receipt_id: Optional[str] = None
    model_status: Optional[str] = None
    elapsed_ms: Optional[int] = None
    label: Optional[str] = None
    assumptions: List[str] = Field(default_factory=list)
    evidence_basis: Optional[str] = None


class PredictResponse(_SeerEnvelope):
    success: bool
    scenario: str
    time_horizon: str
    risks: List[RiskItem]
    opportunities: List[OpportunityItem]
    overall_outlook: str
    confidence: str
    reasoning: str
    raw_response: Optional[str] = None
    error: Optional[str] = None


class TrendsRequest(BaseModel):
    """Topic for trend analysis."""

    topic: str = Field(..., min_length=1, max_length=seer_core.MAX_SCENARIO_CHARS)
    context: Optional[str] = Field(None, max_length=seer_core.MAX_CONTEXT_CHARS)
    evidence: Optional[List[EvidenceItem]] = Field(None, max_length=seer_core.MAX_EVIDENCE_ITEMS)


class TrendItem(BaseModel):
    trend: str
    evidence: str
    timeline: str


class TrendsResponse(_SeerEnvelope):
    success: bool
    topic: str
    emerging: List[TrendItem]
    declining: List[TrendItem]
    disruption: Optional[TrendItem] = None
    raw_response: Optional[str] = None
    generated_at: str
    error: Optional[str] = None


def _provenance(payload: Dict[str, Any], schema_tag: str) -> Dict[str, Any]:
    if payload.get("success"):
        attempts = 1
        try:
            attempts = int(payload.get("attempts") or 1)
        except (TypeError, ValueError):
            attempts = 1
        return {
            "origin": "model",
            "provider_invoked": True,
            "provider": "openclaw",
            "degraded": False,
            # A second model attempt after a schema rejection; never padding.
            "repair_applied": attempts > 1,
            "validated_evidence": ["level_model_completion_receipt", schema_tag],
        }
    return {
        "origin": "model_unavailable",
        "provider_invoked": False,
        "provider": None,
        "degraded": True,
        "repair_applied": False,
        "validated_evidence": [],
    }


def _fields(model_cls: type[BaseModel], payload: Dict[str, Any]) -> Dict[str, Any]:
    return {k: v for k, v in payload.items() if k in model_cls.model_fields}


def _evidence(items: Optional[List[EvidenceItem]]) -> Optional[List[Dict[str, Any]]]:
    return [item.model_dump() for item in items] if items else None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("/status")
async def seer_status():
    """Return Seer status measured from recent real model calls."""

    lane = model_lane_readiness()
    outcomes = seer_core.OUTCOMES.snapshot()
    counts = seer_core.counters()
    return {
        "success": True,
        "level": 30,
        "name": "Seer",
        "status": seer_core.OUTCOMES.health(lane),
        "model_backed": True,
        "model_lane": lane,
        "recent_outcomes": outcomes,
        "predictions_count": counts["predictions"] + counts["trends"],
        "counts": counts,
        "capabilities": ["prediction", "trend_analysis", "forecasting"],
        "deadline_s": SEER_DEADLINE_S,
        "grounding": "model knowledge plus caller-supplied context/evidence only (no live data feed)",
        "fallback": "none (failures return success:false with empty results)",
    }


@router.post("/predict", response_model=PredictResponse)
async def predict(request: PredictRequest, http_request: Request = None):  # type: ignore[assignment]
    """Structured risk/opportunity forecast for a scenario (model-backed)."""

    scope = principal_scope_for_request(http_request, seer_core.NAME)
    try:
        payload = await seer_core.predict_scenario(
            request.scenario,
            request.time_horizon or "6 months",
            principal_scope_key=scope,
            context=request.context,
            evidence=_evidence(request.evidence),
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    body = {**_fields(PredictResponse, payload), **_provenance(payload, "prediction_schema_complete")}
    return PredictResponse(**body)


@router.post("/trends", response_model=TrendsResponse)
async def trends(request: TrendsRequest, http_request: Request = None):  # type: ignore[assignment]
    """Emerging / declining trends and one potential disruption (model-backed)."""

    scope = principal_scope_for_request(http_request, seer_core.NAME)
    try:
        payload = await seer_core.analyze_trends(
            request.topic,
            principal_scope_key=scope,
            context=request.context,
            evidence=_evidence(request.evidence),
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    body = {
        **_fields(TrendsResponse, payload),
        **_provenance(payload, "trends_schema_complete"),
        "generated_at": datetime.now().isoformat(),
    }
    return TrendsResponse(**body)
