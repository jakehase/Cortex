"""
Simulator Router - API endpoints for L20 Simulator.

Real scenario simulation powered by Oracle (L5).
Simulates best-case, most-likely, and worst-case outcomes.
"""

import json
import time
from typing import Any, Dict, List, Optional

import httpx
from fastapi import APIRouter, Request
from pydantic import BaseModel

router = APIRouter()

# ---------------------------------------------------------------------------
# Module-level state
# ---------------------------------------------------------------------------

_scenarios_history: List[Dict[str, Any]] = []
_simulations_run: int = 0

# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------


class SimulatorRequest(BaseModel):
    """Request body for scenario simulation."""
    scenario: str
    risk_tolerance: Optional[str] = "moderate"  # low / moderate / high
    time_horizon: Optional[str] = "6 months"
    mode: Optional[str] = "fast"  # fast|deep
    debug: Optional[bool] = False


class OutcomeResult(BaseModel):
    label: str  # best_case / most_likely / worst_case
    probability: str
    key_events: List[str]
    timeline: str
    impact_assessment: str


class SimulationResponse(BaseModel):
    success: bool
    scenario: str
    risk_tolerance: str
    time_horizon: str
    outcomes: List[OutcomeResult]
    timestamp: float
    error: Optional[str] = None


# ---------------------------------------------------------------------------
# Augmenter/Oracle helper (strict JSON)
# ---------------------------------------------------------------------------

AUGMENTER_URL = "http://127.0.0.1:8888/augmenter/chat"


async def _call_augmenter(prompt: str, system: str, timeout_s: float) -> Dict[str, Any]:
    """Call Augmenter (L38) which routes to Oracle (L5) and can repair JSON contracts."""
    async with httpx.AsyncClient(timeout=timeout_s) as client:
        resp = await client.post(
            AUGMENTER_URL,
            json={
                "prompt": prompt,
                "system": system,
                "response_mode": "json_only",
                "priority": "normal",
            },
        )
        resp.raise_for_status()
        return resp.json()

async def _call_oracle_fallback(prompt: str, timeout_s: float) -> Dict[str, Any]:
    """Fallback path when Augmenter times out: call Oracle directly."""
    async with httpx.AsyncClient(timeout=timeout_s) as client:
        resp = await client.post(
            "http://127.0.0.1:8888/oracle/chat",
            json={"prompt": prompt, "response_mode": "json_only", "priority": "high"},
            headers={"x-augmenter-bypass": "1"},
        )
        resp.raise_for_status()
        return resp.json()


def _parse_outcomes_strict(raw_json: Any) -> List[OutcomeResult]:
    """Strict parsing: require exactly 3 outcomes with required fields."""
    if isinstance(raw_json, str):
        raw_json = json.loads(raw_json)

    if isinstance(raw_json, dict) and "outcomes" in raw_json:
        raw_json = raw_json["outcomes"]

    if not isinstance(raw_json, list) or len(raw_json) != 3:
        raise ValueError("contract violation: outcomes must be a list of exactly 3 items")

    out: List[OutcomeResult] = []
    for item in raw_json:
        if not isinstance(item, dict):
            raise ValueError("contract violation: outcome item must be object")
        out.append(OutcomeResult(**item))
    return out
# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post("/run")
async def run_simulation(request: SimulatorRequest, http_request: Request):
    """Run a real scenario simulation via Oracle (L5).

    Returns 3 possible outcomes: best case, most likely, worst case.
    """
    global _simulations_run

    system_prompt = (
        "You are a scenario simulator. You provide grounded, realistic analysis. "
        "Always respond with a valid JSON object containing an 'outcomes' array with exactly 3 items. "
        "Each item must have: label (best_case/most_likely/worst_case), probability (string like '25%'), "
        "key_events (array of strings), timeline (string), impact_assessment (string). "
        "Be specific and grounded in your analysis."
    )

    user_prompt = (
        f"Given this scenario: {request.scenario}\n"
        f"Risk tolerance: {request.risk_tolerance}\n"
        f"Time horizon: {request.time_horizon}\n\n"
        f"Simulate 3 possible outcomes:\n"
        f"1) Best case\n"
        f"2) Most likely\n"
        f"3) Worst case\n\n"
        f"For each outcome, provide: probability estimate (0-100%), "
        f"key events that lead to it, timeline, and impact assessment. "
        f"Be specific and grounded. Return valid JSON."
    )

    # Guardrails
    scenario = (request.scenario or "").strip()
    if len(scenario) > 2000:
        scenario = scenario[:2000] + "…"

    mode = (request.mode or "fast").lower().strip()
    timeout_s = 9.0 if mode != "deep" else 14.0

    retry_note = None
    try:
        try:
            from cortex_server.middleware.hud_middleware import track_attempt
            track_attempt(http_request, 38, "Augmenter", status="attempted")
        except Exception:
            pass
        try:
            aug = await _call_augmenter(user_prompt, system_prompt, timeout_s=timeout_s)
        except httpx.TimeoutException:
            retry_note = "augmenter_timeout_retry"
            aug = await _call_augmenter(user_prompt, system_prompt, timeout_s=timeout_s + 3.0)

        try:
            from cortex_server.middleware.hud_middleware import track_attempt
            track_attempt(http_request, 38, "Augmenter", status="success")
        except Exception:
            pass

        # Augmenter/Oracle responses vary; accept common fields.
        candidate = None
        if isinstance(aug, dict):
            for k in ("json", "data", "outcomes", "response", "text"):
                if k in aug:
                    candidate = aug[k]
                    break
        outcomes = _parse_outcomes_strict(candidate)

        # Truthful UI: record that this request depended on Augmenter + Oracle
        try:
            from cortex_server.middleware.hud_middleware import track_level
            track_level(http_request, 38, "Augmenter", always_on=False)
            track_level(http_request, 5, "Oracle", always_on=True)
        except Exception:
            pass

    except httpx.TimeoutException:
        # Fallback: direct oracle call for degraded but useful output.
        try:
            from cortex_server.middleware.hud_middleware import track_attempt
            track_attempt(http_request, 38, "Augmenter", status="failed", error="timeout")
            track_attempt(http_request, 5, "Oracle", status="attempted")
        except Exception:
            pass
        try:
            raw = await _call_oracle_fallback(user_prompt, timeout_s=8.0)
            candidate = raw.get("response") if isinstance(raw, dict) else raw
            outcomes = _parse_outcomes_strict(candidate)
            try:
                from cortex_server.middleware.hud_middleware import track_level, track_attempt
                track_level(http_request, 5, "Oracle", always_on=True)
                track_attempt(http_request, 5, "Oracle", status="success")
            except Exception:
                pass
            return SimulationResponse(
                success=True,
                scenario=request.scenario,
                risk_tolerance=request.risk_tolerance or "moderate",
                time_horizon=request.time_horizon or "6 months",
                outcomes=outcomes,
                timestamp=time.time(),
                error="degraded_path:augmenter_timeout_fallback_to_oracle",
            )
        except Exception as fallback_exc:
            try:
                from cortex_server.middleware.hud_middleware import track_attempt
                track_attempt(http_request, 5, "Oracle", status="failed", error=f"{type(fallback_exc).__name__}:{fallback_exc}")
            except Exception:
                pass
            return SimulationResponse(
                success=False,
                scenario=request.scenario,
                risk_tolerance=request.risk_tolerance or "moderate",
                time_horizon=request.time_horizon or "6 months",
                outcomes=[],
                timestamp=time.time(),
                error=f"Timed out after retries ({int(timeout_s)}s base, mode={mode}).",
            )
    except Exception as e:
        # Fail closed on contract violations; optionally expose raw payload in debug.
        err = f"Simulator contract/augmenter error: {str(e)}"
        if getattr(request, 'debug', False):
            err += f" | raw={str(aug)[:1200] if 'aug' in locals() else 'n/a'}"
        return SimulationResponse(
            success=False,
            scenario=request.scenario,
            risk_tolerance=request.risk_tolerance or "moderate",
            time_horizon=request.time_horizon or "6 months",
            outcomes=[],
            timestamp=time.time(),
            error=err,
        )

    _simulations_run += 1

    # Store in history (max 20)
    record = {
        "scenario": request.scenario,
        "risk_tolerance": request.risk_tolerance,
        "time_horizon": request.time_horizon,
        "outcomes_count": len(outcomes),
        "timestamp": time.time(),
    }
    _scenarios_history.append(record)
    if len(_scenarios_history) > 20:
        _scenarios_history.pop(0)

    return SimulationResponse(
        success=True,
        scenario=request.scenario,
        risk_tolerance=request.risk_tolerance or "moderate",
        time_horizon=request.time_horizon or "6 months",
        outcomes=outcomes,
        timestamp=time.time(),
        error=(retry_note if retry_note else None),
    )


@router.get("/scenarios")
async def list_scenarios():
    """Return list of previously run scenarios (max 20)."""
    return {
        "success": True,
        "data": {
            "scenarios": _scenarios_history,
            "count": len(_scenarios_history),
            "total_run": _simulations_run,
        },
        "error": None,
    }


@router.get("/status")
async def simulator_status():
    """Return Simulator status."""
    return {
        "success": True,
        "data": {
            "level": 20,
            "name": "The Simulator",
            "status": "active",
            "scenarios_run": _simulations_run,
            "scenarios_in_history": len(_scenarios_history),
            "capabilities": ["scenario_simulation", "outcome_analysis", "risk_assessment"],
        },
        "error": None,
    }
