"""
Level 10: Listener — Audio Analysis & Text Processing

Honest about STT limitations (Whisper not installed), but provides
real value through Oracle-powered text analysis. Accepts transcribed
text for sentiment, key points, action items, and summaries.
"""
from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
import httpx

router = APIRouter()

# ── Config ──────────────────────────────────────────────────────────────────
ORACLE_URL = "http://localhost:8888/oracle/chat"

# ── In-memory stats ────────────────────────────────────────────────────────
_stats = {
    "transcribe_requests": 0,
    "analysis_requests": 0,
    "analysis_successes": 0,
}


# ── Models ──────────────────────────────────────────────────────────────────

class TranscribeRequest(BaseModel):
    """Audio transcription request."""
    audio_base64: Optional[str] = None
    file_path: Optional[str] = None
    format: Optional[str] = "unknown"
    duration_seconds: Optional[float] = None
    language: str = "en"
    description: Optional[str] = None  # human description of the audio


class AnalyzeRequest(BaseModel):
    """Text analysis request (for already-transcribed content)."""
    text: str
    context: Optional[str] = None      # optional context about where the text came from
    tasks: Optional[List[str]] = None  # e.g. ["sentiment", "summary", "action_items"]


# ── Helpers ─────────────────────────────────────────────────────────────────

async def _ask_oracle(prompt: str) -> Optional[str]:
    """Call Oracle with high priority and 90s timeout."""
    try:
        async with httpx.AsyncClient(timeout=90.0) as client:
            resp = await client.post(
                ORACLE_URL,
                json={
                    "message": prompt,
                    "priority": "high",
                },
            )
            if resp.status_code == 200:
                data = resp.json()
                return data.get("response") or data.get("reply") or data.get("text") or str(data)
    except Exception as exc:
        return f"[Oracle unavailable: {exc}]"
    return None


# ── Routes ──────────────────────────────────────────────────────────────────

@router.get("/status")
async def listener_status():
    """L10 status — honest about capabilities."""
    return {
        "success": True,
        "data": {
            "level": 10,
            "name": "Listener",
            "status": "active",
            "stt_available": False,
            "stt_reason": "Whisper is not installed on this system",
            "text_analysis": True,
            "text_analysis_via": "Oracle (cloud reasoning)",
            "transcribe_requests": _stats["transcribe_requests"],
            "analysis_requests": _stats["analysis_requests"],
            "analysis_successes": _stats["analysis_successes"],
            "capabilities": [
                "audio_metadata_guidance",
                "text_sentiment_analysis",
                "text_summarization",
                "action_item_extraction",
                "key_point_extraction",
            ],
            "timestamp": datetime.now().isoformat(),
        },
        "error": None,
    }


@router.post("/transcribe")
async def transcribe_audio(request: TranscribeRequest):
    """
    Accept audio input. Since Whisper isn't available, honestly explain
    the situation and suggest alternatives via Oracle.
    """
    _stats["transcribe_requests"] += 1

    # Build metadata description
    meta_parts = []
    if request.format and request.format != "unknown":
        meta_parts.append(f"format: {request.format}")
    if request.duration_seconds:
        meta_parts.append(f"duration: {request.duration_seconds}s")
    if request.language:
        meta_parts.append(f"language: {request.language}")
    if request.description:
        meta_parts.append(f"description: {request.description}")
    if request.audio_base64:
        size_kb = round(len(request.audio_base64) * 3 / 4 / 1024, 1)
        meta_parts.append(f"base64 payload: ~{size_kb} KB")
    if request.file_path:
        meta_parts.append(f"file path: {request.file_path}")

    metadata_str = ", ".join(meta_parts) if meta_parts else "no metadata provided"

    prompt = (
        f"You were given audio content described as: [{metadata_str}]. "
        "Since the Cortex doesn't have Whisper or any STT engine installed, "
        "I can't process audio directly. Provide a helpful, concise response:\n"
        "1) What free/open-source tools could transcribe this (Whisper, Vosk, etc.)\n"
        "2) What cloud services are available (Google STT, AWS Transcribe, OpenAI Whisper API)\n"
        "3) Offer to process the text if the user can provide it manually\n"
        "Keep it practical and brief — 3-4 sentences max."
    )

    oracle_response = await _ask_oracle(prompt)

    return {
        "success": True,
        "stt_available": False,
        "transcription": None,
        "metadata_received": metadata_str,
        "guidance": oracle_response or (
            "Whisper is not installed. You can install it with "
            "`pip install openai-whisper` or use the OpenAI Whisper API. "
            "Alternatively, paste the text and use /listener/analyze."
        ),
        "next_step": "If you already have the text, POST it to /listener/analyze for sentiment, summary, and action items.",
        "timestamp": datetime.now().isoformat(),
    }


@router.post("/analyze")
async def analyze_text(request: AnalyzeRequest):
    """
    Analyze already-transcribed text via Oracle.
    Returns sentiment, key points, action items, and summary.
    """
    _stats["analysis_requests"] += 1

    if not request.text or not request.text.strip():
        return {"success": False, "error": "No text provided for analysis"}

    # Determine requested tasks
    tasks = request.tasks or ["sentiment", "summary", "key_points", "action_items"]
    task_str = ", ".join(tasks)

    context_note = ""
    if request.context:
        context_note = f"\nContext about this text: {request.context}\n"

    prompt = (
        f"Analyze the following text and provide a structured analysis. "
        f"Requested analysis types: {task_str}.{context_note}\n\n"
        f"TEXT:\n\"\"\"\n{request.text[:4000]}\"\"\"\n\n"
        "Respond in this exact structure:\n"
        "SENTIMENT: [positive/negative/neutral/mixed] — [brief explanation]\n"
        "SUMMARY: [2-3 sentence summary]\n"
        "KEY POINTS:\n- [point 1]\n- [point 2]\n- [point 3]\n"
        "ACTION ITEMS:\n- [action 1]\n- [action 2]\n"
        "(If a section has nothing relevant, write 'None identified')"
    )

    oracle_response = await _ask_oracle(prompt)

    if oracle_response and "[Oracle unavailable" not in oracle_response:
        _stats["analysis_successes"] += 1
        return {
            "success": True,
            "text_length": len(request.text),
            "tasks_requested": tasks,
            "analysis": oracle_response,
            "analyzed_via": "Oracle (cloud reasoning)",
            "timestamp": datetime.now().isoformat(),
        }
    else:
        return {
            "success": False,
            "error": "Oracle is unavailable for text analysis",
            "detail": oracle_response,
            "text_length": len(request.text),
            "timestamp": datetime.now().isoformat(),
        }
