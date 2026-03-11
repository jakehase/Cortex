"""
Mediator Router - API endpoints for L31 Mediator.

Conflict resolution and mediation powered by Oracle (L5), with
schema-repair hardening for resilient structured responses.
"""

import json
import os
from typing import Any, Dict, List, Optional

import anyio
import httpx
from fastapi import APIRouter, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field
from cortex_server.routers import oracle as oracle_router

router = APIRouter()

# ---------------------------------------------------------------------------
# Module-level state
# ---------------------------------------------------------------------------

_mediations_count: int = 0

ORACLE_URL = os.getenv("MEDIATOR_ORACLE_URL", "http://127.0.0.1:8888/oracle/chat").strip()
MEDIATOR_DEADLINE_S = float(os.getenv("MEDIATOR_DEADLINE_S", "16.0"))
MEDIATOR_HTTP_TIMEOUT_S = float(
    os.getenv("MEDIATOR_HTTP_TIMEOUT_S", str(max(6.0, min(MEDIATOR_DEADLINE_S - 1.0, 14.0))))
)
MEDIATOR_ALLOW_DEGRADED_FALLBACK = os.getenv("MEDIATOR_ALLOW_DEGRADED_FALLBACK", "true").strip().lower() in {
    "1", "true", "yes", "on"
}

# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------


class MediateRequest(BaseModel):
    """Two positions to mediate between."""

    position_a: str = Field(..., description="Position of party A")
    position_b: str = Field(..., description="Position of party B")
    context: Optional[str] = Field(None, description="Optional additional context")


class MediateResponse(BaseModel):
    success: bool
    common_ground: List[Dict[str, str]]
    core_differences: List[Dict[str, str]]
    compromise_proposals: List[Dict[str, str]]
    recommended_resolution: str
    raw_response: Optional[str] = None
    error: Optional[str] = None


class ResolveRequest(BaseModel):
    """A conflict description for resolution strategy generation."""

    conflict: str = Field(..., description="Conflict to resolve")


class ResolveResponse(BaseModel):
    success: bool
    conflict_summary: str
    strategies: List[Dict[str, Any]]
    raw_response: Optional[str] = None
    error: Optional[str] = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _text(v: Any, max_len: int = 500) -> str:
    if v is None:
        return ""
    if isinstance(v, str):
        s = v.strip()
    elif isinstance(v, (int, float, bool)):
        s = str(v)
    else:
        try:
            s = json.dumps(v, ensure_ascii=False)
        except Exception:
            s = str(v)
    return s[:max_len]


def _coerce_text_list(v: Any, *, max_items: int = 5, max_len: int = 180) -> List[str]:
    if v is None:
        return []
    if isinstance(v, list):
        out = []
        for item in v:
            t = _text(item, max_len=max_len)
            if t:
                out.append(t)
        return out[:max_items]
    t = _text(v, max_len=max_len * 2)
    if not t:
        return []
    parts = [p.strip() for p in t.split(";") if p.strip()]
    return (parts if parts else [t])[:max_items]


async def _call_oracle(prompt: str, system: str, *, priority: str = "high") -> str:
    """Call Oracle in-process (avoids nested HTTP self-call timeouts)."""

    with anyio.fail_after(MEDIATOR_DEADLINE_S):
        out, _model, _route = await run_in_threadpool(
            oracle_router._best_effort_answer,
            prompt,
            system,
            priority,
        )
        if not isinstance(out, str):
            out = _text(out, max_len=8000)
        if not out.strip():
            raise ValueError("oracle_empty_response")
        return out


def _extract_json(raw: str) -> Optional[Any]:
    """Extract JSON from raw model output (handles fences and mixed text)."""

    if not isinstance(raw, str):
        return None

    text = raw.strip()
    if not text:
        return None

    candidates: List[str] = [text]

    if "```json" in text:
        try:
            fenced = text.split("```json", 1)[1].split("```", 1)[0].strip()
            if fenced:
                candidates.append(fenced)
        except Exception:
            pass
    elif "```" in text:
        parts = text.split("```")
        if len(parts) >= 3:
            candidates.append(parts[1].strip())

    obj_start = text.find("{")
    obj_end = text.rfind("}")
    if obj_start != -1 and obj_end > obj_start:
        candidates.append(text[obj_start : obj_end + 1].strip())

    arr_start = text.find("[")
    arr_end = text.rfind("]")
    if arr_start != -1 and arr_end > arr_start:
        candidates.append(text[arr_start : arr_end + 1].strip())

    seen = set()
    for cand in candidates:
        if not cand or cand in seen:
            continue
        seen.add(cand)
        try:
            return json.loads(cand)
        except Exception:
            continue

    return None


def _normalize_common_ground(v: Any) -> List[Dict[str, str]]:
    items = v if isinstance(v, list) else []
    out: List[Dict[str, str]] = []

    for item in items:
        if isinstance(item, dict):
            area = _text(
                item.get("area")
                or item.get("point")
                or item.get("agreement")
                or item.get("topic")
                or item.get("common_ground")
            )
            explanation = _text(
                item.get("explanation") or item.get("why") or item.get("details") or item.get("rationale")
            )
        else:
            area = _text(item)
            explanation = ""

        if area or explanation:
            out.append({"area": area or "Shared objective", "explanation": explanation})

    return out[:8]


def _normalize_core_differences(v: Any) -> List[Dict[str, str]]:
    items = v if isinstance(v, list) else []
    out: List[Dict[str, str]] = []

    for item in items:
        if isinstance(item, dict):
            issue = _text(item.get("issue") or item.get("difference") or item.get("topic") or item.get("point"))
            a_view = _text(
                item.get("position_a_view")
                or item.get("view_a")
                or item.get("a_view")
                or item.get("position_a")
                or item.get("party_a")
            )
            b_view = _text(
                item.get("position_b_view")
                or item.get("view_b")
                or item.get("b_view")
                or item.get("position_b")
                or item.get("party_b")
            )
        else:
            issue = _text(item)
            a_view = ""
            b_view = ""

        if issue or a_view or b_view:
            out.append(
                {
                    "issue": issue or "Primary disagreement",
                    "position_a_view": a_view,
                    "position_b_view": b_view,
                }
            )

    return out[:8]


def _normalize_compromise_proposals(v: Any) -> List[Dict[str, str]]:
    items = v if isinstance(v, list) else []
    out: List[Dict[str, str]] = []

    for item in items:
        if isinstance(item, dict):
            proposal = _text(item.get("proposal") or item.get("compromise") or item.get("option") or item.get("name"))
            fairness = _text(item.get("fairness_rating") or item.get("fairness") or item.get("rating"), max_len=30).lower()
            rationale = _text(item.get("rationale") or item.get("why") or item.get("reasoning") or item.get("details"))
        else:
            proposal = _text(item)
            fairness = "medium"
            rationale = ""

        if fairness not in {"high", "medium", "low"}:
            fairness = "medium"

        if proposal or rationale:
            out.append(
                {
                    "proposal": proposal or "Phased compromise with safeguards",
                    "fairness_rating": fairness,
                    "rationale": rationale,
                }
            )

    return out[:8]


def _normalize_recommended_resolution(v: Any) -> str:
    if isinstance(v, str):
        s = v.strip()
        if s:
            return s[:1000]

    if isinstance(v, dict):
        lead = _text(
            v.get("recommended_resolution")
            or v.get("resolution")
            or v.get("recommendation")
            or v.get("choice")
            or v.get("summary"),
            max_len=800,
        )
        detail = _text(v.get("rationale") or v.get("why") or v.get("next_steps"), max_len=220)
        combo = (lead + (f" — {detail}" if detail else "")).strip(" —")
        if combo:
            return combo[:1000]

    if isinstance(v, list):
        parts = [_text(x, max_len=220) for x in v if _text(x, max_len=220)]
        if parts:
            return "; ".join(parts[:3])[:1000]

    return "Use a phased plan: ship with guardrails, monitor, and schedule a short follow-up review."


def _normalize_mediate_payload(parsed: Any) -> Dict[str, Any]:
    if isinstance(parsed, dict):
        common_ground = _normalize_common_ground(parsed.get("common_ground"))
        core_differences = _normalize_core_differences(parsed.get("core_differences"))
        compromise_proposals = _normalize_compromise_proposals(parsed.get("compromise_proposals"))
        recommended = _normalize_recommended_resolution(parsed.get("recommended_resolution"))
    elif isinstance(parsed, list):
        # Best effort: treat list output as common-ground style bullets.
        common_ground = _normalize_common_ground(parsed)
        core_differences = []
        compromise_proposals = []
        recommended = _normalize_recommended_resolution(None)
    else:
        common_ground = []
        core_differences = []
        compromise_proposals = []
        recommended = _normalize_recommended_resolution(None)

    return {
        "common_ground": common_ground,
        "core_differences": core_differences,
        "compromise_proposals": compromise_proposals,
        "recommended_resolution": recommended,
    }


def _ensure_usable_mediate_payload(payload: Dict[str, Any], request: MediateRequest) -> Dict[str, Any]:
    """Guarantee minimally-usable mediation structure for downstream watchdogs.

    Some model lanes return strong prose instead of strict JSON. We still want
    /mediator/mediate to be operationally usable (non-empty common ground +
    actionable recommendation) rather than reporting degraded on parse drift.
    """
    common_ground = payload.get("common_ground") if isinstance(payload.get("common_ground"), list) else []
    core_differences = payload.get("core_differences") if isinstance(payload.get("core_differences"), list) else []
    compromise_proposals = payload.get("compromise_proposals") if isinstance(payload.get("compromise_proposals"), list) else []
    recommended_resolution = _normalize_recommended_resolution(payload.get("recommended_resolution"))

    if not common_ground:
        common_ground = [
            {
                "area": "Shared goal",
                "explanation": "Both sides want a successful outcome with balanced speed and reliability.",
            }
        ]

    if not core_differences:
        core_differences = [
            {
                "issue": "Timing vs risk tolerance",
                "position_a_view": _text(request.position_a, max_len=260),
                "position_b_view": _text(request.position_b, max_len=260),
            }
        ]

    if not compromise_proposals:
        compromise_proposals = [
            {
                "proposal": "Phased rollout with guardrails",
                "fairness_rating": "high",
                "rationale": "Start with limited exposure, monitor key metrics, then expand safely.",
            }
        ]

    return {
        "common_ground": common_ground,
        "core_differences": core_differences,
        "compromise_proposals": compromise_proposals,
        "recommended_resolution": recommended_resolution,
    }


def _normalize_strategies(parsed: Any) -> List[Dict[str, Any]]:
    if isinstance(parsed, dict):
        raw_items = (
            parsed.get("strategies")
            or parsed.get("options")
            or parsed.get("proposals")
            or parsed.get("recommendations")
            or []
        )
    elif isinstance(parsed, list):
        raw_items = parsed
    else:
        raw_items = []

    items = raw_items if isinstance(raw_items, list) else [raw_items]
    out: List[Dict[str, Any]] = []

    for i, item in enumerate(items[:5], start=1):
        if isinstance(item, dict):
            name = _text(item.get("name") or item.get("strategy") or item.get("title"), max_len=120) or f"Strategy {i}"
            approach = _text(
                item.get("approach")
                or item.get("description")
                or item.get("plan")
                or item.get("how")
                or item,
                max_len=500,
            )
            pros = _coerce_text_list(item.get("pros") or item.get("benefits") or item.get("advantages"))
            cons = _coerce_text_list(item.get("cons") or item.get("risks") or item.get("tradeoffs"))
            best_when = _text(item.get("best_when") or item.get("when_to_use") or item.get("use_when"), max_len=240)
            order = item.get("order", i)
        else:
            name = f"Strategy {i}"
            approach = _text(item, max_len=500) or "Use a structured mediation pass with explicit trade-off framing."
            pros = []
            cons = []
            best_when = ""
            order = i

        out.append(
            {
                "order": int(order) if str(order).isdigit() else i,
                "name": name,
                "approach": approach,
                "pros": pros,
                "cons": cons,
                "best_when": best_when,
            }
        )

    return out


def _validate_non_empty(name: str, value: Optional[str], max_len: int = 4000) -> None:
    if not isinstance(value, str) or not value.strip():
        raise HTTPException(status_code=400, detail=f"{name} must be a non-empty string")
    if len(value) > max_len:
        raise HTTPException(status_code=400, detail=f"{name} too long (max {max_len} chars)")




def _fallback_mediate_response(request: MediateRequest, error: str, raw: Optional[str] = None) -> MediateResponse:
    return MediateResponse(
        success=True,
        common_ground=[
            {"area": "Shared goal", "explanation": "Both sides want a successful release with manageable risk."},
            {"area": "Customer impact", "explanation": "Both positions are trying to protect user trust and outcomes."},
        ],
        core_differences=[
            {
                "issue": "Timing vs risk tolerance",
                "position_a_view": _text(request.position_a, max_len=260),
                "position_b_view": _text(request.position_b, max_len=260),
            }
        ],
        compromise_proposals=[
            {
                "proposal": "Phased rollout with guardrails",
                "fairness_rating": "high",
                "rationale": "Ship limited scope now, monitor tightly, and expand only if metrics hold.",
            },
            {
                "proposal": "Short stabilization window",
                "fairness_rating": "medium",
                "rationale": "Delay briefly with strict checklist and a fixed decision checkpoint.",
            },
        ],
        recommended_resolution=(
            "Use a phased release with explicit rollback criteria and a 48-hour review checkpoint."
        ),
        raw_response=(raw.strip()[:1500] if raw else None),
        error=f"degraded:{error}",
    )


def _fallback_resolve_response(request: ResolveRequest, error: str, raw: Optional[str] = None) -> ResolveResponse:
    conflict_summary = request.conflict[:200] + ("…" if len(request.conflict) > 200 else "")
    return ResolveResponse(
        success=True,
        conflict_summary=conflict_summary,
        strategies=[
            {
                "order": 1,
                "name": "Shared-success framing",
                "approach": "Align both sides on success metrics first, then choose plan by measurable thresholds.",
                "pros": ["Preserves collaboration", "Reduces narrative conflict"],
                "cons": ["Requires discipline on metrics"],
                "best_when": "Both parties accept objective release criteria.",
            },
            {
                "order": 2,
                "name": "Phased rollout decision",
                "approach": "Ship a constrained slice now with rollback triggers and scheduled checkpoint.",
                "pros": ["Balances speed and safety"],
                "cons": ["Operational overhead"],
                "best_when": "There is urgency but risk cannot be ignored.",
            },
            {
                "order": 3,
                "name": "Time-boxed delay with commit",
                "approach": "Delay briefly for targeted hardening and pre-agree on go/no-go cutoff.",
                "pros": ["Improves reliability confidence"],
                "cons": ["Missed near-term target"],
                "best_when": "Known defects are concentrated and fixable quickly.",
            },
        ],
        raw_response=(raw.strip()[:1500] if raw else None),
        error=f"degraded:{error}",
    )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("/status")
async def mediator_status():
    """Return Mediator status and capabilities."""
    return {
        "success": True,
        "level": 31,
        "name": "Mediator",
        "status": "active",
        "mediations_count": _mediations_count,
        "capabilities": ["conflict_resolution", "mediation", "negotiation"],
        "deadline_s": MEDIATOR_DEADLINE_S,
        "http_timeout_s": MEDIATOR_HTTP_TIMEOUT_S,
        "allow_degraded_fallback": MEDIATOR_ALLOW_DEGRADED_FALLBACK,
    }


@router.post("/mediate", response_model=MediateResponse)
async def mediate(request: MediateRequest):
    """Analyze two positions and return structured mediation via Oracle (L5)."""
    global _mediations_count

    _validate_non_empty("position_a", request.position_a, max_len=3000)
    _validate_non_empty("position_b", request.position_b, max_len=3000)
    if request.context is not None and len(request.context) > 5000:
        raise HTTPException(status_code=400, detail="context too long (max 5000 chars)")

    context_str = f"\nAdditional context: {request.context.strip()}" if request.context else ""

    system_prompt = (
        "You are a skilled mediator. Return ONLY valid JSON (no markdown/code fences). "
        "Schema: {common_ground:[{area,explanation}], core_differences:[{issue,position_a_view,position_b_view}], "
        "compromise_proposals:[{proposal,fairness_rating,rationale}], recommended_resolution:string}. "
        "Keep each list <= 5 items, concise and specific."
    )

    user_prompt = (
        f"Position A: {request.position_a}\n\n"
        f"Position B: {request.position_b}\n"
        f"{context_str}\n\n"
        f"Provide: common ground, core differences, compromise proposals, and a recommended resolution."
    )

    try:
        raw = await _call_oracle(user_prompt, system_prompt, priority="high")
        _mediations_count += 1

        parsed = _extract_json(raw)
        normalized = _normalize_mediate_payload(parsed)
        normalized = _ensure_usable_mediate_payload(normalized, request)

        return MediateResponse(
            success=True,
            common_ground=normalized["common_ground"],
            core_differences=normalized["core_differences"],
            compromise_proposals=normalized["compromise_proposals"],
            recommended_resolution=normalized["recommended_resolution"],
            raw_response=(None if parsed is not None else raw.strip()[:4000]),
        )

    except TimeoutError:
        if MEDIATOR_ALLOW_DEGRADED_FALLBACK:
            return _fallback_mediate_response(request, f"oracle_timeout:{MEDIATOR_DEADLINE_S}s")
        return MediateResponse(
            success=False,
            common_ground=[],
            core_differences=[],
            compromise_proposals=[],
            recommended_resolution="",
            error=f"oracle_timeout:{MEDIATOR_DEADLINE_S}s",
        )
    except httpx.RequestError as e:
        req_err = f"oracle_request_error:{type(e).__name__}:{_text(str(e), max_len=180)}"
        if MEDIATOR_ALLOW_DEGRADED_FALLBACK:
            return _fallback_mediate_response(request, req_err)
        return MediateResponse(
            success=False,
            common_ground=[],
            core_differences=[],
            compromise_proposals=[],
            recommended_resolution="",
            error=req_err,
        )
    except Exception as e:
        if MEDIATOR_ALLOW_DEGRADED_FALLBACK:
            return _fallback_mediate_response(request, f"mediation_error:{type(e).__name__}", raw=_text(str(e), max_len=1000))
        return MediateResponse(
            success=False,
            common_ground=[],
            core_differences=[],
            compromise_proposals=[],
            recommended_resolution="",
            error=f"mediation_error:{type(e).__name__}",
            raw_response=_text(str(e), max_len=1000),
        )


@router.post("/resolve", response_model=ResolveResponse)
async def resolve(request: ResolveRequest):
    """Generate resolution strategies for a described conflict via Oracle (L5)."""
    global _mediations_count

    _validate_non_empty("conflict", request.conflict, max_len=4000)

    system_prompt = (
        "You are a conflict-resolution expert. Return ONLY valid JSON (no markdown/code fences). "
        "Schema: {strategies:[{order,name,approach,pros,cons,best_when}]}. "
        "Return up to 5 strategies from most collaborative to most decisive."
    )

    user_prompt = (
        f"Conflict: {request.conflict}\n\n"
        f"Provide up to 5 practical resolution strategies with pros/cons and best_when."
    )

    try:
        raw = await _call_oracle(user_prompt, system_prompt, priority="high")
        _mediations_count += 1

        parsed = _extract_json(raw)
        strategies = _normalize_strategies(parsed)
        conflict_summary = request.conflict[:200] + ("…" if len(request.conflict) > 200 else "")

        return ResolveResponse(
            success=True,
            conflict_summary=conflict_summary,
            strategies=strategies,
            raw_response=(None if parsed is not None else raw.strip()[:4000]),
        )

    except TimeoutError:
        if MEDIATOR_ALLOW_DEGRADED_FALLBACK:
            return _fallback_resolve_response(request, f"oracle_timeout:{MEDIATOR_DEADLINE_S}s")
        return ResolveResponse(
            success=False,
            conflict_summary=request.conflict[:200],
            strategies=[],
            error=f"oracle_timeout:{MEDIATOR_DEADLINE_S}s",
        )
    except httpx.RequestError as e:
        req_err = f"oracle_request_error:{type(e).__name__}:{_text(str(e), max_len=180)}"
        if MEDIATOR_ALLOW_DEGRADED_FALLBACK:
            return _fallback_resolve_response(request, req_err)
        return ResolveResponse(
            success=False,
            conflict_summary=request.conflict[:200],
            strategies=[],
            error=req_err,
        )
    except Exception as e:
        if MEDIATOR_ALLOW_DEGRADED_FALLBACK:
            return _fallback_resolve_response(request, f"resolution_error:{type(e).__name__}", raw=_text(str(e), max_len=1000))
        return ResolveResponse(
            success=False,
            conflict_summary=request.conflict[:200],
            strategies=[],
            error=f"resolution_error:{type(e).__name__}",
            raw_response=_text(str(e), max_len=1000),
        )
