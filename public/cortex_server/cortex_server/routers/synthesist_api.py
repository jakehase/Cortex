"""Synthesist Router - L32 strict contracts + stable synthesis outputs."""
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from datetime import datetime, timedelta
from typing import Dict, Any, List, Optional

router = APIRouter()

_seen_insight_types: Dict[str, datetime] = {}
_last_important_insights: List[Dict[str, Any]] = []
_rejected_payloads = 0


def _get_synthesist():
    try:
        from cortex_server.modules.synthesist import get_synthesist
        return get_synthesist()
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Synthesist unavailable: {exc}")


class IngestRequest(BaseModel):
    level_name: str = Field(min_length=1)
    data: Dict[str, Any]


class SynthesizeRequest(BaseModel):
    query_context: Optional[Dict[str, Any]] = None


@router.get('/status')
async def synthesist_status():
    synth = _get_synthesist()
    status = synth.status()
    return {
        'success': True,
        **status,
        'contract_version': 'v1',
        'mode': 'full',
        'rejected_payloads': _rejected_payloads,
        'capabilities': [
            'cross_level_synthesis',
            'knowledge_ingestion',
            'meta_pattern_discovery',
            'insight_generation',
        ],
    }


@router.post('/ingest')
async def ingest_knowledge(request: IngestRequest, http_request: Request):
    synth = _get_synthesist()
    try:
        result = synth.ingest_from_level(request.level_name, request.data)
        try:
            from cortex_server.middleware.hud_middleware import track_level
            # If ingress explicitly carries awareness-origin signal, surface L37 in chain telemetry.
            payload_text = str(request.data).lower()
            if request.level_name.lower() == 'awareness' or 'awareness' in payload_text:
                track_level(http_request, 37, 'Awareness', always_on=False)
        except Exception:
            pass
        return {'success': True, **result}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f'Ingestion failed: {exc}')


@router.post('/synthesize')
async def run_synthesis(request: Optional[SynthesizeRequest] = None):
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
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f'Synthesis failed: {exc}')


@router.get('/insights')
async def get_insights(limit: int = 10):
    synth = _get_synthesist()
    try:
        insights = synth.get_insights(limit=limit)
        return {'success': True, 'count': len(insights), 'insights': insights}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f'Failed to retrieve insights: {exc}')


@router.get('/patterns')
async def get_patterns(limit: int = 10, pattern_type: Optional[str] = None):
    synth = _get_synthesist()
    try:
        patterns = synth.get_patterns(pattern_type=pattern_type, limit=limit)
        return {'success': True, 'count': len(patterns), 'patterns': patterns, 'pattern_type': pattern_type}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f'Failed to retrieve patterns: {exc}')


def _extract_insight_pattern(insight: Dict[str, Any]) -> str:
    insight_type = insight.get('type', 'unknown')
    text = insight.get('insight', insight.get('description', insight.get('content', '')))
    return f"{insight_type}:{str(text).lower().strip()[:160]}"


def _is_insight_novel(insight: Dict[str, Any]) -> bool:
    pattern = _extract_insight_pattern(insight)
    now = datetime.now()
    prev = _seen_insight_types.get(pattern)
    if prev and (now - prev) < timedelta(hours=24):
        return False
    _seen_insight_types[pattern] = now
    return True


@router.get('/important_insights')
async def get_important_insights(limit: int = 10, min_confidence: float = 0.8):
    synth = _get_synthesist()
    try:
        all_insights = synth.get_insights(limit=max(limit * 3, 50))
        important = []
        for insight in all_insights:
            c = insight.get('confidence', 0.0)
            if isinstance(c, (int, float)) and c >= min_confidence and _is_insight_novel(insight):
                important.append(insight)
        global _last_important_insights
        _last_important_insights = important[:limit]
        return {
            'success': True,
            'count': len(_last_important_insights),
            'insights': _last_important_insights,
            'min_confidence': min_confidence,
            'timestamp': datetime.now().isoformat(),
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f'Failed to retrieve important insights: {exc}')


@router.get('/important_insights/stats')
async def get_important_insights_stats():
    cutoff = datetime.now() - timedelta(hours=48)
    stale = [k for k, v in _seen_insight_types.items() if v < cutoff]
    for k in stale:
        _seen_insight_types.pop(k, None)
    return {
        'success': True,
        'tracked_patterns': len(_seen_insight_types),
        'cached_important_insights': len(_last_important_insights),
        'rejected_payloads': _rejected_payloads,
        'stale_patterns_cleaned': len(stale),
        'threshold_hours': 24,
    }
