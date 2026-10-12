"""
Level 10: Listener — input analysis and intent recognition.

* POST /listener/analyze — model-backed (gpt-5.6-sol via the Oracle lane)
  intent / sentiment / urgency / entity / action-item analysis of text.
  On model failure it returns ``success: false`` and no analysis.
* POST /listener/transcribe — speech-to-text is not implemented in Cortex, so
  this answers HTTP 501 and never claims success. Supplied paths are never read.
* GET /listener/status — derived from real state (STT unavailable; the
  analysis lane's last observed outcome since boot).
"""
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from cortex_server.modules import level_model
from cortex_server.modules import listener as listener_core

router = APIRouter()


# ── Models ──────────────────────────────────────────────────────────────────

class TranscribeRequest(BaseModel):
    """Audio transcription request (kept for compatibility; STT is unavailable)."""
    audio_base64: Optional[str] = None
    file_path: Optional[str] = None  # accepted for compatibility, never read
    format: Optional[str] = "unknown"
    duration_seconds: Optional[float] = None
    language: str = "en"
    description: Optional[str] = None


class AnalyzeRequest(BaseModel):
    """Text analysis request (a message or an already-transcribed text)."""
    text: str
    context: Optional[str] = None      # where the text came from
    tasks: Optional[List[str]] = None  # e.g. ["sentiment", "summary", "action_items"]


# ── Routes ──────────────────────────────────────────────────────────────────

@router.get("/status")
async def listener_status():
    """L10 status derived from observed state, not a static capability list."""
    stats = listener_core.stats_snapshot()
    stt = listener_core.stt_status()
    last_status = stats.get("last_analysis_status")
    if last_status is None:
        analysis_health = "unverified"
    elif last_status == "ok":
        analysis_health = "ok"
    else:
        analysis_health = "degraded"
    capabilities = ["text_intent_analysis"] if analysis_health != "degraded" else []
    return {
        "success": True,
        "data": {
            "level": 10,
            "name": "Listener",
            "status": "active" if analysis_health != "degraded" else "degraded",
            "stt_available": stt["available"],
            "stt_reason": stt["reason"],
            # True only once a model-backed analysis has succeeded since boot.
            "text_analysis": analysis_health == "ok",
            "text_analysis_health": analysis_health,
            "text_analysis_via": "level_model (gpt-5.6-sol through the Oracle lane)",
            "last_analysis_status": last_status,
            "last_analysis_at": stats.get("last_analysis_at"),
            "last_success_at": stats.get("last_success_at"),
            "counters_scope": "since_boot",
            "counters_since": stats.get("since"),
            "transcribe_requests": stats.get("transcribe_requests", 0),
            "analysis_requests": stats.get("analysis_requests", 0),
            "analysis_successes": stats.get("analysis_successes", 0),
            "analysis_failures": stats.get("analysis_failures", 0),
            "capabilities": capabilities,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        },
        "error": None,
    }


@router.post("/transcribe")
async def transcribe_audio(request: TranscribeRequest):
    """Speech-to-text is not implemented; answer honestly with 501."""
    listener_core.note_transcribe_request()
    stt = listener_core.stt_status()
    return JSONResponse(
        status_code=501,
        content={
            "success": False,
            "stt_available": False,
            "transcription": None,
            "error": "speech_to_text_unavailable",
            "detail": stt["reason"],
            "next_step": "If you already have the text, POST it to /listener/analyze.",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        },
    )


@router.post("/analyze")
async def analyze_text(request: AnalyzeRequest, http_request: Request):
    """Model-backed structured analysis of text (HTTP 200; success:false on failure)."""
    return await listener_core.analyze_text(
        request.text,
        principal_scope_key=level_model.scope_key_for_request(http_request, "listener"),
        context=request.context,
        tasks=request.tasks,
    )
