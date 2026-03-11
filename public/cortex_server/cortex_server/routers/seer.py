"""
Seer Router - API endpoints for L30 Seer.

Real prediction and trend analysis powered by Oracle (L5).

Audit notes (2026-02-16):
- Enforce an internal deadline (< gateway timeout) so requests don't hit the global ~25s timeout.
- Fail closed: never return success:true with unparsed/invalid content.
- Validate Oracle JSON shape with Pydantic, including exact item counts.
- Bypass Augmenter for latency/reliability (header: x-augmenter-bypass: 1).
"""

import json
import os
from datetime import datetime
from typing import Any, Dict, List, Optional

import anyio
import httpx
from fastapi import APIRouter
from pydantic import BaseModel, Field, ValidationError

router = APIRouter()

# ---------------------------------------------------------------------------
# Module-level state
# ---------------------------------------------------------------------------

_predictions_count: int = 0

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

ORACLE_URL = os.getenv("SEER_ORACLE_URL", "http://localhost:8888/oracle/chat")

# Must be comfortably below the API gateway timeout (~25s).
SEER_DEADLINE_S = float(os.getenv("SEER_DEADLINE_S", "18"))

# HTTP client timeout (keep slightly under the overall deadline).
SEER_HTTP_TIMEOUT_S = float(
    os.getenv("SEER_HTTP_TIMEOUT_S", str(max(5.0, min(SEER_DEADLINE_S - 1.0, 20.0))))
)

# Retry tuning for transient Oracle transport issues.
SEER_ORACLE_MAX_ATTEMPTS = int(os.getenv("SEER_ORACLE_MAX_ATTEMPTS", "2"))
SEER_RETRY_BACKOFF_S = float(os.getenv("SEER_RETRY_BACKOFF_S", "0.35"))

# If enabled, include raw_response in error payloads (useful for debugging prompt drift).
SEER_DEBUG_RAW_RESPONSE = os.getenv("SEER_DEBUG_RAW_RESPONSE", "").strip().lower() in {
    "1",
    "true",
    "yes",
    "on",
}

# If Oracle is unreachable, return structured degraded output instead of empty payloads.
SEER_ALLOW_DEGRADED_FALLBACK = os.getenv("SEER_ALLOW_DEGRADED_FALLBACK", "true").strip().lower() in {
    "1", "true", "yes", "on"
}

# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------


class PredictRequest(BaseModel):
    """Scenario for risk/opportunity analysis."""

    scenario: str
    time_horizon: Optional[str] = "6 months"


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


class PredictResponse(BaseModel):
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

    topic: str


class TrendItem(BaseModel):
    trend: str
    evidence: str
    timeline: str


class TrendsResponse(BaseModel):
    success: bool
    topic: str
    emerging: List[TrendItem]
    declining: List[TrendItem]
    disruption: TrendItem
    raw_response: Optional[str] = None
    generated_at: str
    error: Optional[str] = None


# Internal validation envelopes (exact counts enforced)
class _PredictEnvelope(BaseModel):
    # At least the required count; we'll truncate to exactly N for stable output.
    risks: List[RiskItem] = Field(min_length=3)
    opportunities: List[OpportunityItem] = Field(min_length=3)
    overall_outlook: str
    confidence: str
    reasoning: str


class _TrendsEnvelope(BaseModel):
    # At least the required count; we'll truncate to exactly N for stable output.
    emerging: List[TrendItem] = Field(min_length=3)
    declining: List[TrendItem] = Field(min_length=2)
    disruption: TrendItem


# ---------------------------------------------------------------------------
# Oracle helper
# ---------------------------------------------------------------------------


async def _call_oracle(prompt: str, system: str) -> str:
    """Call Oracle with bounded retries under a strict total deadline."""

    attempts = max(1, min(SEER_ORACLE_MAX_ATTEMPTS, 3))
    per_attempt_timeout = max(4.0, min(SEER_HTTP_TIMEOUT_S, (SEER_DEADLINE_S - 1.0) / attempts))
    last_err: Optional[Exception] = None

    with anyio.fail_after(SEER_DEADLINE_S):
        for i in range(1, attempts + 1):
            try:
                async with httpx.AsyncClient(timeout=httpx.Timeout(per_attempt_timeout)) as client:
                    resp = await client.post(
                        ORACLE_URL,
                        json={"prompt": prompt, "system": system, "priority": "normal"},
                        headers={"x-augmenter-bypass": "1"},
                    )
                    resp.raise_for_status()
                    data = resp.json()
                    text = data.get("response", data.get("text"))
                    if not isinstance(text, str):
                        raise ValueError("oracle_non_string_response")
                    if not text.strip():
                        raise ValueError("oracle_empty_response")
                    return text
            except (httpx.RequestError, httpx.HTTPStatusError, ValueError) as e:
                last_err = e
                if i >= attempts:
                    raise
                await anyio.sleep(SEER_RETRY_BACKOFF_S * i)

    # Defensive fallback (deadline path should have raised already)
    if last_err:
        raise last_err
    raise RuntimeError("oracle_unknown_error")


def _extract_json(raw: str) -> Optional[dict]:
    """Try to extract JSON from a response that may have markdown wrapping."""

    text = (raw or "").strip()

    # Strip fenced blocks if present
    if "```json" in text:
        text = text.split("```json", 1)[1].split("```", 1)[0].strip()
    elif "```" in text:
        parts = text.split("```")
        if len(parts) >= 3:
            text = parts[1].strip()

    try:
        return json.loads(text)
    except Exception:
        return None


def _confidence_to_label(value: Any) -> str:
    """Normalize confidence to low/medium/high."""

    if value is None:
        return "medium"

    # Already a label
    if isinstance(value, str):
        v = value.strip().lower()
        if v in {"low", "medium", "high"}:
            return v
        # Some models return words like "0.72" as strings
        try:
            value = float(v)
        except Exception:
            return "medium"

    # Numeric (0..1 or 0..100)
    if isinstance(value, (int, float)):
        x = float(value)
        if x > 1.0 and x <= 100.0:
            x = x / 100.0
        if x >= 0.75:
            return "high"
        if x >= 0.45:
            return "medium"
        return "low"

    return "medium"


def _normalize_predict_payload(parsed: Dict[str, Any]) -> Dict[str, Any]:
    """Coerce common Oracle variants into Seer's canonical predict schema."""

    risks = parsed.get("risks") or []
    opportunities = parsed.get("opportunities") or []

    overall_outlook = parsed.get("overall_outlook")
    confidence = parsed.get("confidence")
    reasoning = parsed.get("reasoning")

    if isinstance(overall_outlook, dict):
        # Common variant: {stance: "neutral", confidence: 0.72, reasoning: "..."}
        stance = (
            overall_outlook.get("stance")
            or overall_outlook.get("outlook")
            or overall_outlook.get("overall_outlook")
        )
        if confidence is None:
            confidence = overall_outlook.get("confidence")
        if not (isinstance(reasoning, str) and reasoning.strip()):
            reasoning = overall_outlook.get("reasoning")
        overall_outlook = stance

    if not isinstance(overall_outlook, str) or not overall_outlook.strip():
        overall_outlook = "neutral"

    confidence_label = _confidence_to_label(confidence)

    if not isinstance(reasoning, str):
        reasoning = ""

    return {
        "risks": risks,
        "opportunities": opportunities,
        "overall_outlook": overall_outlook.strip(),
        "confidence": confidence_label,
        "reasoning": reasoning.strip(),
    }


def _normalize_trends_payload(parsed: Dict[str, Any]) -> Dict[str, Any]:
    """Coerce common Oracle variants into Seer's canonical trends schema."""

    emerging = parsed.get("emerging") or []
    declining = parsed.get("declining") or []

    disruption = parsed.get("disruption")
    if disruption is None:
        disruption = parsed.get("potential_disruption")

    if disruption is None:
        disruption = {}

    # Variant: potential_disruption: {disruption: "...", evidence: "...", timeline: "..."}
    if isinstance(disruption, dict) and "trend" not in disruption and "disruption" in disruption:
        disruption = {
            "trend": disruption.get("disruption", ""),
            "evidence": disruption.get("evidence", ""),
            "timeline": disruption.get("timeline", ""),
        }

    return {"emerging": emerging, "declining": declining, "disruption": disruption}



# ---------------------------------------------------------------------------
# Repair helpers (schema rescue)
# ---------------------------------------------------------------------------

_ALLOWED_SEVERITY = {"low", "medium", "high", "critical"}
_ALLOWED_LIKELIHOOD = {"unlikely", "possible", "likely", "certain"}
_ALLOWED_IMPACT = {"low", "medium", "high", "transformative"}
_ALLOWED_DIFFICULTY = {"easy", "moderate", "hard"}
_ALLOWED_OUTLOOK = {"bullish", "bearish", "neutral"}


def _norm_choice(value: Any, allowed: set[str], default: str) -> str:
    if isinstance(value, str):
        v = value.strip().lower()
        if v in allowed:
            return v
    return default


def _coerce_risk_item(item: Any, scenario: str, idx: int) -> Dict[str, str]:
    if isinstance(item, dict):
        risk = str(item.get("risk") or item.get("name") or item.get("title") or "").strip()
        severity = _norm_choice(item.get("severity"), _ALLOWED_SEVERITY, "medium")
        likelihood = _norm_choice(item.get("likelihood"), _ALLOWED_LIKELIHOOD, "possible")
        mitigation = str(item.get("mitigation") or item.get("action") or "").strip()
    elif isinstance(item, str):
        risk = item.strip()
        severity = "medium"
        likelihood = "possible"
        mitigation = ""
    else:
        risk = ""
        severity = "medium"
        likelihood = "possible"
        mitigation = ""

    if not risk:
        risk = f"Execution risk #{idx + 1} for scenario: {scenario}"
    if not mitigation:
        mitigation = "Monitor leading indicators and prepare a contingency response."

    return {
        "risk": risk,
        "severity": severity,
        "likelihood": likelihood,
        "mitigation": mitigation,
    }


def _coerce_opportunity_item(item: Any, scenario: str, idx: int) -> Dict[str, str]:
    if isinstance(item, dict):
        opp = str(item.get("opportunity") or item.get("name") or item.get("title") or "").strip()
        impact = _norm_choice(item.get("impact"), _ALLOWED_IMPACT, "medium")
        difficulty = _norm_choice(item.get("difficulty"), _ALLOWED_DIFFICULTY, "moderate")
        action = str(item.get("action") or item.get("next_step") or "").strip()
    elif isinstance(item, str):
        opp = item.strip()
        impact = "medium"
        difficulty = "moderate"
        action = ""
    else:
        opp = ""
        impact = "medium"
        difficulty = "moderate"
        action = ""

    if not opp:
        opp = f"Opportunity #{idx + 1} in scenario: {scenario}"
    if not action:
        action = "Run a small pilot and measure outcome before scaling."

    return {
        "opportunity": opp,
        "impact": impact,
        "difficulty": difficulty,
        "action": action,
    }


def _coerce_trend_item(item: Any, topic: str, idx: int, kind: str) -> Dict[str, str]:
    if isinstance(item, dict):
        trend = str(item.get("trend") or item.get("name") or item.get("title") or item.get("disruption") or "").strip()
        evidence = str(item.get("evidence") or item.get("why") or "").strip()
        timeline = str(item.get("timeline") or item.get("horizon") or "").strip()
    elif isinstance(item, str):
        trend = item.strip()
        evidence = ""
        timeline = ""
    else:
        trend = ""
        evidence = ""
        timeline = ""

    if not trend:
        trend = f"{kind.capitalize()} trend #{idx + 1} for {topic}"
    if not evidence:
        evidence = "Observed in recent operating patterns and model outputs."
    if not timeline:
        timeline = "6-12 months"

    return {"trend": trend, "evidence": evidence, "timeline": timeline}


def _repair_predict_payload(canonical: Dict[str, Any], scenario: str, time_horizon: str) -> Dict[str, Any]:
    risks_raw = canonical.get("risks") if isinstance(canonical.get("risks"), list) else []
    opp_raw = canonical.get("opportunities") if isinstance(canonical.get("opportunities"), list) else []

    risks = [_coerce_risk_item(it, scenario, i) for i, it in enumerate(risks_raw)]
    opportunities = [_coerce_opportunity_item(it, scenario, i) for i, it in enumerate(opp_raw)]

    while len(risks) < 3:
        risks.append(_coerce_risk_item({}, scenario, len(risks)))
    while len(opportunities) < 3:
        opportunities.append(_coerce_opportunity_item({}, scenario, len(opportunities)))

    overall_outlook = _norm_choice(canonical.get("overall_outlook"), _ALLOWED_OUTLOOK, "neutral")
    confidence = _confidence_to_label(canonical.get("confidence"))
    reasoning = str(canonical.get("reasoning") or "").strip()
    if not reasoning:
        reasoning = f"Model returned partial structure for {time_horizon}; Seer normalized output to canonical schema."

    return {
        "risks": risks[:3],
        "opportunities": opportunities[:3],
        "overall_outlook": overall_outlook,
        "confidence": confidence,
        "reasoning": reasoning,
    }


def _repair_trends_payload(canonical: Dict[str, Any], topic: str) -> Dict[str, Any]:
    emerging_raw = canonical.get("emerging") if isinstance(canonical.get("emerging"), list) else []
    declining_raw = canonical.get("declining") if isinstance(canonical.get("declining"), list) else []

    emerging = [_coerce_trend_item(it, topic, i, "emerging") for i, it in enumerate(emerging_raw)]
    declining = [_coerce_trend_item(it, topic, i, "declining") for i, it in enumerate(declining_raw)]

    while len(emerging) < 3:
        emerging.append(_coerce_trend_item({}, topic, len(emerging), "emerging"))
    while len(declining) < 2:
        declining.append(_coerce_trend_item({}, topic, len(declining), "declining"))

    disruption = _coerce_trend_item(canonical.get("disruption") or {}, topic, 0, "disruption")

    return {
        "emerging": emerging[:3],
        "declining": declining[:2],
        "disruption": disruption,
    }





def _fallback_predict_response(request: PredictRequest, error: str, raw: Optional[str]) -> PredictResponse:
    repaired = _repair_predict_payload(
        {"risks": [], "opportunities": [], "overall_outlook": "neutral", "confidence": "low", "reasoning": ""},
        scenario=request.scenario,
        time_horizon=request.time_horizon or "6 months",
    )
    envelope = _PredictEnvelope.model_validate(repaired)
    return PredictResponse(
        success=True,
        scenario=request.scenario,
        time_horizon=request.time_horizon or "6 months",
        risks=envelope.risks[:3],
        opportunities=envelope.opportunities[:3],
        overall_outlook=envelope.overall_outlook,
        confidence="low",
        reasoning=(
            f"Seer returned degraded fallback output because Oracle was unavailable ({error}). "
            "Use as provisional guidance and re-run for live foresight."
        ),
        raw_response=(raw.strip() if (SEER_DEBUG_RAW_RESPONSE and raw) else None),
        error=f"degraded:{error}",
    )


def _fallback_trends_response(request: TrendsRequest, error: str, raw: Optional[str]) -> TrendsResponse:
    repaired = _repair_trends_payload({"emerging": [], "declining": [], "disruption": {}}, topic=request.topic)
    envelope = _TrendsEnvelope.model_validate(repaired)
    return TrendsResponse(
        success=True,
        topic=request.topic,
        emerging=envelope.emerging[:3],
        declining=envelope.declining[:2],
        disruption=envelope.disruption,
        raw_response=(raw.strip() if (SEER_DEBUG_RAW_RESPONSE and raw) else None),
        generated_at=datetime.now().isoformat(),
        error=f"degraded:{error}",
    )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("/status")
async def seer_status():
    """Return Seer status and capabilities."""

    return {
        "success": True,
        "level": 30,
        "name": "Seer",
        "status": "active",
        "predictions_count": _predictions_count,
        "capabilities": ["prediction", "trend_analysis", "forecasting"],
        "deadline_s": SEER_DEADLINE_S,
        "http_timeout_s": SEER_HTTP_TIMEOUT_S,
        "oracle_max_attempts": SEER_ORACLE_MAX_ATTEMPTS,
        "retry_backoff_s": SEER_RETRY_BACKOFF_S,
        "allow_degraded_fallback": SEER_ALLOW_DEGRADED_FALLBACK,
        "debug_raw_response": SEER_DEBUG_RAW_RESPONSE,
    }


@router.post("/predict", response_model=PredictResponse)
async def predict(request: PredictRequest):
    """Analyze a scenario and return a structured risk/opportunity assessment via Oracle (L5)."""

    global _predictions_count

    system_prompt = (
        "You are a strategic forecaster. Provide structured analysis. "
        "Always respond with valid JSON in this format:\n"
        '{"risks": [{"risk": "...", "severity": "low/medium/high/critical", '
        '"likelihood": "unlikely/possible/likely/certain", "mitigation": "..."}], '
        '"opportunities": [{"opportunity": "...", "impact": "low/medium/high/transformative", '
        '"difficulty": "easy/moderate/hard", "action": "..."}], '
        '"overall_outlook": "bullish/bearish/neutral", '
        '"confidence": "low/medium/high", '
        '"reasoning": "..."}\n'
        "Provide exactly 3 risks and 3 opportunities."
    )

    user_prompt = (
        f"For this scenario: {request.scenario}\n"
        f"Time horizon: {request.time_horizon}\n\n"
        "Provide:\n"
        "1) 3 key risks with severity/likelihood/mitigation\n"
        "2) 3 key opportunities with impact/difficulty/action\n"
        "3) Overall outlook (bullish/bearish/neutral) with confidence level and reasoning\n\n"
        "Return valid JSON only."
    )

    raw: Optional[str] = None
    try:
        raw = await _call_oracle(user_prompt, system_prompt)
        parsed = _extract_json(raw)
        if parsed is None:
            raise ValueError("oracle_invalid_json")

        canonical = _normalize_predict_payload(parsed)
        repaired = _repair_predict_payload(
            canonical,
            scenario=request.scenario,
            time_horizon=request.time_horizon or "6 months",
        )
        envelope = _PredictEnvelope.model_validate(repaired)
        _predictions_count += 1

        return PredictResponse(
            success=True,
            scenario=request.scenario,
            time_horizon=request.time_horizon or "6 months",
            risks=envelope.risks[:3],
            opportunities=envelope.opportunities[:3],
            overall_outlook=envelope.overall_outlook,
            confidence=envelope.confidence,
            reasoning=envelope.reasoning,
        )

    except TimeoutError:
        if SEER_ALLOW_DEGRADED_FALLBACK:
            return _fallback_predict_response(request, f"oracle_timeout:{SEER_DEADLINE_S}s", raw)
        return PredictResponse(
            success=False,
            scenario=request.scenario,
            time_horizon=request.time_horizon or "6 months",
            risks=[],
            opportunities=[],
            overall_outlook="",
            confidence="",
            reasoning="",
            raw_response=(raw.strip() if (SEER_DEBUG_RAW_RESPONSE and raw) else None),
            error=f"oracle_timeout:{SEER_DEADLINE_S}s",
        )
    except httpx.HTTPStatusError as e:
        return PredictResponse(
            success=False,
            scenario=request.scenario,
            time_horizon=request.time_horizon or "6 months",
            risks=[],
            opportunities=[],
            overall_outlook="",
            confidence="",
            reasoning="",
            raw_response=(raw.strip() if (SEER_DEBUG_RAW_RESPONSE and raw) else None),
            error=f"oracle_http_status:{e.response.status_code}",
        )
    except httpx.RequestError:
        if SEER_ALLOW_DEGRADED_FALLBACK:
            return _fallback_predict_response(request, "oracle_request_error", raw)
        return PredictResponse(
            success=False,
            scenario=request.scenario,
            time_horizon=request.time_horizon or "6 months",
            risks=[],
            opportunities=[],
            overall_outlook="",
            confidence="",
            reasoning="",
            raw_response=(raw.strip() if (SEER_DEBUG_RAW_RESPONSE and raw) else None),
            error="oracle_request_error",
        )
    except ValueError as e:
        # Raised for empty responses, invalid JSON, etc.
        return PredictResponse(
            success=False,
            scenario=request.scenario,
            time_horizon=request.time_horizon or "6 months",
            risks=[],
            opportunities=[],
            overall_outlook="",
            confidence="",
            reasoning="",
            raw_response=(raw.strip() if (SEER_DEBUG_RAW_RESPONSE and raw) else None),
            error=str(e),
        )
    except ValidationError:
        if SEER_ALLOW_DEGRADED_FALLBACK:
            return _fallback_predict_response(request, "oracle_invalid_json_schema", raw)
        return PredictResponse(
            success=False,
            scenario=request.scenario,
            time_horizon=request.time_horizon or "6 months",
            risks=[],
            opportunities=[],
            overall_outlook="",
            confidence="",
            reasoning="",
            raw_response=(raw.strip() if (SEER_DEBUG_RAW_RESPONSE and raw) else None),
            error="oracle_invalid_json_schema",
        )
    except Exception as e:
        if SEER_ALLOW_DEGRADED_FALLBACK:
            return _fallback_predict_response(request, f"seer_unknown_error:{type(e).__name__}", raw)
        return PredictResponse(
            success=False,
            scenario=request.scenario,
            time_horizon=request.time_horizon or "6 months",
            risks=[],
            opportunities=[],
            overall_outlook="",
            confidence="",
            reasoning="",
            raw_response=(raw.strip() if (SEER_DEBUG_RAW_RESPONSE and raw) else None),
            error=f"seer_unknown_error:{type(e).__name__}",
        )


@router.post("/trends", response_model=TrendsResponse)
async def trends(request: TrendsRequest):
    """Analyze trends in a topic via Oracle (L5).

    Returns emerging trends, declining trends, and potential disruptions.
    """

    global _predictions_count

    system_prompt = (
        "You are a trend analyst. Always respond with valid JSON in this format:\n"
        '{"emerging": [{"trend": "...", "evidence": "...", "timeline": "..."}], '
        '"declining": [{"trend": "...", "evidence": "...", "timeline": "..."}], '
        '"disruption": {"trend": "...", "evidence": "...", "timeline": "..."}}\n'
        "Provide exactly 3 emerging, 2 declining, and 1 disruption."
    )

    user_prompt = (
        f"Analyze current trends in: {request.topic}\n\n"
        "Identify:\n"
        "1) 3 emerging trends (growing)\n"
        "2) 2 declining trends\n"
        "3) 1 potential disruption\n\n"
        "For each, explain the evidence and timeline. Return valid JSON only."
    )

    raw: Optional[str] = None
    try:
        raw = await _call_oracle(user_prompt, system_prompt)
        parsed = _extract_json(raw)
        if parsed is None:
            raise ValueError("oracle_invalid_json")

        canonical = _normalize_trends_payload(parsed)
        repaired = _repair_trends_payload(canonical, topic=request.topic)
        envelope = _TrendsEnvelope.model_validate(repaired)
        _predictions_count += 1

        return TrendsResponse(
            success=True,
            topic=request.topic,
            emerging=envelope.emerging[:3],
            declining=envelope.declining[:2],
            disruption=envelope.disruption,
            generated_at=datetime.now().isoformat(),
        )

    except TimeoutError:
        if SEER_ALLOW_DEGRADED_FALLBACK:
            return _fallback_trends_response(request, f"oracle_timeout:{SEER_DEADLINE_S}s", raw)
        return TrendsResponse(
            success=False,
            topic=request.topic,
            emerging=[],
            declining=[],
            disruption=TrendItem(trend="", evidence="", timeline=""),
            raw_response=(raw.strip() if (SEER_DEBUG_RAW_RESPONSE and raw) else None),
            generated_at=datetime.now().isoformat(),
            error=f"oracle_timeout:{SEER_DEADLINE_S}s",
        )
    except httpx.HTTPStatusError as e:
        return TrendsResponse(
            success=False,
            topic=request.topic,
            emerging=[],
            declining=[],
            disruption=TrendItem(trend="", evidence="", timeline=""),
            raw_response=(raw.strip() if (SEER_DEBUG_RAW_RESPONSE and raw) else None),
            generated_at=datetime.now().isoformat(),
            error=f"oracle_http_status:{e.response.status_code}",
        )
    except httpx.RequestError:
        if SEER_ALLOW_DEGRADED_FALLBACK:
            return _fallback_trends_response(request, "oracle_request_error", raw)
        return TrendsResponse(
            success=False,
            topic=request.topic,
            emerging=[],
            declining=[],
            disruption=TrendItem(trend="", evidence="", timeline=""),
            raw_response=(raw.strip() if (SEER_DEBUG_RAW_RESPONSE and raw) else None),
            generated_at=datetime.now().isoformat(),
            error="oracle_request_error",
        )
    except ValidationError:
        if SEER_ALLOW_DEGRADED_FALLBACK:
            return _fallback_trends_response(request, "oracle_invalid_json_schema", raw)
        return TrendsResponse(
            success=False,
            topic=request.topic,
            emerging=[],
            declining=[],
            disruption=TrendItem(trend="", evidence="", timeline=""),
            raw_response=(raw.strip() if (SEER_DEBUG_RAW_RESPONSE and raw) else None),
            generated_at=datetime.now().isoformat(),
            error="oracle_invalid_json_schema",
        )
    except Exception as e:
        if SEER_ALLOW_DEGRADED_FALLBACK:
            return _fallback_trends_response(request, f"seer_unknown_error:{type(e).__name__}", raw)
        return TrendsResponse(
            success=False,
            topic=request.topic,
            emerging=[],
            declining=[],
            disruption=TrendItem(trend="", evidence="", timeline=""),
            raw_response=(raw.strip() if (SEER_DEBUG_RAW_RESPONSE and raw) else None),
            generated_at=datetime.now().isoformat(),
            error=f"seer_unknown_error:{type(e).__name__}",
        )
