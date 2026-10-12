"""Synthesist Router - L32.

* POST /synthesist_api/synthesize_turn — model-backed synthesis of the level
  results produced for one turn (the real L32 capability).
* POST /synthesist_api/ingest, /synthesize, GET /insights, /patterns,
  /important_insights[/stats] — heuristic telemetry over in-process level
  activity reports: literal counts only, labelled degraded, no confidence.
"""
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from cortex_server.modules import level_model
from cortex_server.modules.provider_result import provider_result_fields

router = APIRouter()

_rejected_payloads = 0


def _get_synthesist():
    try:
        from cortex_server.modules.synthesist import get_synthesist
        return get_synthesist()
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Synthesist unavailable: {type(exc).__name__}")


def _principal_key(http_request: Optional[Request]) -> Optional[str]:
    state = getattr(http_request, "state", None) if http_request is not None else None
    principal = getattr(state, "authenticated_memory_principal", None) if state is not None else None
    isolation = getattr(principal, "isolation_key", None)
    if callable(isolation):
        try:
            return str(isolation("level.synthesist.telemetry.v1"))
        except Exception:
            return None
    return None


class IngestRequest(BaseModel):
    level_name: str = Field(min_length=1, max_length=64)
    data: Dict[str, Any]


class SynthesizeRequest(BaseModel):
    query_context: Optional[Dict[str, Any]] = None


class LevelResultIn(BaseModel):
    level: Optional[int] = Field(default=None, ge=1, le=38)
    name: str = Field(min_length=1, max_length=64)
    summary: str = Field(min_length=1, max_length=8000)
    receipt_id: Optional[str] = Field(default=None, max_length=128)
    status: Optional[str] = Field(default=None, max_length=32)


class SynthesizeTurnRequest(BaseModel):
    message: str = Field(min_length=1, max_length=20000)
    level_results: List[LevelResultIn] = Field(max_length=12)
    context: Optional[str] = Field(default=None, max_length=8000)


@router.get('/status')
async def synthesist_status():
    synth = _get_synthesist()
    status = synth.status()
    turn = status.get("turn_synthesis") or {}
    last = turn.get("last_status")
    turn_health = "unverified" if last is None else ("ok" if last == "ok" else "degraded")
    capabilities = ['heuristic_activity_telemetry']
    if turn_health != "degraded":
        capabilities.insert(0, 'model_turn_synthesis')
    return {
        'success': True,
        **status,
        'contract_version': 'v2',
        'mode': 'turn_synthesis_model_backed+heuristic_telemetry',
        'turn_synthesis_health': turn_health,
        'rejected_payloads': _rejected_payloads,
        'capabilities': capabilities,
    }


@router.post('/synthesize_turn')
async def synthesize_turn(request: SynthesizeTurnRequest, http_request: Request):
    """Model-backed synthesis of this turn's level results (HTTP 200; success:false on failure)."""
    from cortex_server.modules.synthesist import synthesize_turn as run_turn

    return await run_turn(
        request.message,
        [row.model_dump() for row in request.level_results],
        principal_scope_key=level_model.scope_key_for_request(http_request, "synthesist"),
        context=request.context,
    )


@router.post('/ingest')
async def ingest_knowledge(request: IngestRequest, http_request: Request):
    synth = _get_synthesist()
    try:
        result = synth.ingest_from_level(request.level_name, request.data, principal_key=_principal_key(http_request))
        try:
            from cortex_server.middleware.hud_middleware import track_level
            payload_text = str(request.data).lower()[:20000]
            if request.level_name.lower() == 'awareness' or 'awareness' in payload_text:
                track_level(http_request, 37, 'Awareness', always_on=False)
        except Exception:
            pass
        return {**result, 'success': bool(result.get('success'))}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f'Ingestion failed: {type(exc).__name__}')


@router.post('/synthesize')
async def run_synthesis(request: Optional[SynthesizeRequest] = None):
    """Heuristic telemetry counts (not a model synthesis; see /synthesize_turn)."""
    synth = _get_synthesist()
    req = request or SynthesizeRequest()
    try:
        result = synth.synthesize(query_context=req.query_context)
        insights = result.get('insights', []) if isinstance(result, dict) else []
        return {
            'success': True,
            'insights_generated': int(result.get('insights_generated', len(insights))) if isinstance(result, dict) else len(insights),
            'meta_patterns_discovered': int(result.get('meta_patterns_discovered', 0)) if isinstance(result, dict) else 0,
            'levels_contributing': int(result.get('levels_contributing', 0)) if isinstance(result, dict) else 0,
            'insights': insights,
            **(result if isinstance(result, dict) else {}),
            'note': 'heuristic telemetry counts; for a model-backed synthesis use /synthesist_api/synthesize_turn',
            **provider_result_fields(
                origin="heuristic",
                provider_invoked=False,
                provider=None,
                degraded=True,
                repair_applied=False,
                validated_evidence=["local_level_knowledge", "local_cross_references"],
            ),
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f'Synthesis failed: {type(exc).__name__}')


@router.get('/insights')
async def get_insights(limit: int = 10):
    synth = _get_synthesist()
    try:
        insights = synth.get_insights(limit=limit)
        return {'success': True, 'count': len(insights), 'insights': insights}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f'Failed to retrieve insights: {type(exc).__name__}')


@router.get('/patterns')
async def get_patterns(limit: int = 10, pattern_type: Optional[str] = None):
    synth = _get_synthesist()
    try:
        patterns = synth.get_patterns(pattern_type=pattern_type, limit=limit)
        return {'success': True, 'count': len(patterns), 'patterns': patterns, 'pattern_type': pattern_type}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f'Failed to retrieve patterns: {type(exc).__name__}')


def _important(insights: List[Dict[str, Any]], min_confidence: float, limit: int) -> List[Dict[str, Any]]:
    """Pure filter: insights carrying a numeric confidence >= threshold, deduplicated."""
    out, seen = [], set()
    for insight in insights:
        c = insight.get('confidence')
        if not isinstance(c, (int, float)) or isinstance(c, bool) or c < min_confidence:
            continue
        key = f"{insight.get('type', '')}:{str(insight.get('insight', '')).lower().strip()[:160]}"
        if key in seen:
            continue
        seen.add(key)
        out.append(insight)
        if len(out) >= limit:
            break
    return out


@router.get('/important_insights')
async def get_important_insights(limit: int = 10, min_confidence: float = 0.8):
    synth = _get_synthesist()
    try:
        all_insights = synth.get_insights(limit=max(limit * 3, 50))
        important = _important(all_insights, min_confidence, limit)
        return {
            'success': True,
            'count': len(important),
            'insights': important,
            'min_confidence': min_confidence,
            'note': 'heuristic telemetry observations carry no confidence and never qualify',
            'timestamp': datetime.now().isoformat(),
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f'Failed to retrieve important insights: {type(exc).__name__}')


@router.get('/important_insights/stats')
async def get_important_insights_stats():
    synth = _get_synthesist()
    stored = synth.get_insights(limit=500)
    with_conf = [i for i in stored if isinstance(i.get('confidence'), (int, float)) and not isinstance(i.get('confidence'), bool)]
    return {
        'success': True,
        'tracked_patterns': len(stored),
        'insights_with_confidence': len(with_conf),
        'cached_important_insights': len(_important(stored, 0.8, 500)),
        'rejected_payloads': _rejected_payloads,
        'stale_patterns_cleaned': 0,
        'threshold_hours': 24,
    }
