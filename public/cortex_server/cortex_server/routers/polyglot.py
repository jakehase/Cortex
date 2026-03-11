"""Polyglot Router - API endpoints for L28 Polyglot.

Goals:
- Fast, reliable responses (strict timeouts on Oracle calls)
- Input hardening (length limits, supported language validation, batch caps)
- Observability (/status includes request counters + last error)

Translation and ambiguous language ID are optionally powered by Oracle (L5).
Heuristic detection is always available as a fast fallback.
"""

from __future__ import annotations

import asyncio
import re
import time
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter()

# ---------------------------------------------------------------------------
# Constants / limits
# ---------------------------------------------------------------------------

MAX_TEXT_CHARS = 5000
MAX_DETECT_CHARS_FOR_ORACLE = 800
MAX_BATCH_ITEMS = 10
# Hard cap for Oracle calls — Polyglot endpoints must not hang.
ORACLE_TIMEOUT_S = 1.25

# ---------------------------------------------------------------------------
# Module-level state (observability)
# ---------------------------------------------------------------------------

_translations_count: int = 0
_detections_count: int = 0
_total_requests: int = 0
_timeout_count: int = 0
_oracle_error_count: int = 0
_last_error: Optional[str] = None
_last_error_at: Optional[float] = None

# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------


class TranslateRequest(BaseModel):
    """Request body for translation."""

    text: str = Field(..., min_length=1, max_length=MAX_TEXT_CHARS)
    target_language: str = Field(..., min_length=1, max_length=64)
    source_language: Optional[str] = Field(None, max_length=64)


class TranslateResponse(BaseModel):
    success: bool
    original_text: str
    translated_text: str
    target_language: str
    source_language: Optional[str]
    error: Optional[str] = None
    method: str = "oracle"


class DetectRequest(BaseModel):
    """Request body for language detection."""

    text: str = Field(..., min_length=1, max_length=MAX_TEXT_CHARS)


class DetectResponse(BaseModel):
    success: bool
    text_sample: str
    detected_language: str
    confidence: float
    method: str
    error: Optional[str] = None


class TranslateBatchRequest(BaseModel):
    texts: list[str] = Field(..., min_length=1, max_length=MAX_BATCH_ITEMS)
    target_language: str = Field(..., min_length=1, max_length=64)
    source_language: Optional[str] = Field(None, max_length=64)


class TranslateBatchResponse(BaseModel):
    success: bool
    target_language: str
    source_language: Optional[str]
    results: list[TranslateResponse]
    error: Optional[str] = None


# ---------------------------------------------------------------------------
# Language detection heuristics
# ---------------------------------------------------------------------------

_LANGUAGE_MARKERS = {
    "en": {
        "the",
        "is",
        "are",
        "was",
        "and",
        "of",
        "to",
        "in",
        "that",
        "it",
        "for",
        "with",
        "you",
        "this",
        "have",
    },
    "es": {"el", "la", "de", "en", "que", "los", "las", "del", "por", "con", "una", "para", "como", "más", "pero"},
    "fr": {"le", "la", "de", "les", "des", "est", "que", "une", "dans", "pour", "pas", "sur", "avec", "qui", "sont"},
    "de": {"der", "die", "und", "den", "das", "ist", "ein", "eine", "von", "mit", "für", "auf", "nicht", "sich", "auch"},
    "pt": {"de", "que", "não", "uma", "para", "com", "por", "mais", "como", "dos", "das", "foi", "seu", "sua", "são"},
    "it": {"di", "che", "non", "una", "per", "con", "sono", "della", "anche", "come", "dal", "dei", "gli", "nel", "più"},
    "ja": {"の", "は", "に", "を", "で", "が", "と", "も", "た", "です"},
    "zh": {"的", "是", "在", "了", "不", "和", "有", "这", "人", "我"},
    "ko": {"이", "는", "을", "의", "에", "가", "를", "한", "로", "도"},
    "ru": {"и", "в", "не", "на", "что", "он", "как", "это", "она", "они"},
    "ar": {"في", "من", "على", "إلى", "أن", "هذا", "التي", "هو", "مع", "كان"},
}

_LANG_NAMES = {
    "en": "English",
    "es": "Spanish",
    "fr": "French",
    "de": "German",
    "pt": "Portuguese",
    "it": "Italian",
    "ja": "Japanese",
    "zh": "Chinese",
    "ko": "Korean",
    "ru": "Russian",
    "ar": "Arabic",
}

_SUPPORTED_LANGUAGE_CODES = set(_LANG_NAMES.keys())
_SUPPORTED_LANGUAGE_NAMES_LOWER = {v.lower(): k for k, v in _LANG_NAMES.items()}


def _detect_language_heuristic(text: str) -> tuple[str, float]:
    """Heuristic language detection using common-word overlap and script checks.

    Returns (language_code, confidence).
    """
    if re.search(r"[\u3040-\u309F\u30A0-\u30FF]", text):
        return "ja", 0.85
    if re.search(r"[\u4E00-\u9FFF]", text):
        return "zh", 0.80
    if re.search(r"[\uAC00-\uD7AF]", text):
        return "ko", 0.85
    if re.search(r"[\u0600-\u06FF]", text):
        return "ar", 0.80
    if re.search(r"[\u0400-\u04FF]", text):
        return "ru", 0.80

    tokens = set(re.findall(r"\b\w+\b", text.lower()))
    best_lang = "en"
    best_score = 0.0

    for lang, markers in _LANGUAGE_MARKERS.items():
        overlap = len(tokens & markers)
        score = overlap / min(len(tokens), len(markers)) if tokens else 0.0
        if score > best_score:
            best_score = score
            best_lang = lang

    confidence = min(round(best_score * 1.2, 2), 1.0)
    return best_lang, max(confidence, 0.1)


def _normalize_language(lang: str) -> tuple[str, str]:
    """Return (lang_code, display_name) from a user-supplied code or name."""
    raw = (lang or "").strip()
    if not raw:
        raise HTTPException(status_code=400, detail="target_language is required")

    if raw.lower() in _SUPPORTED_LANGUAGE_CODES:
        code = raw.lower()
        return code, _LANG_NAMES[code]

    key = raw.lower()
    if key in _SUPPORTED_LANGUAGE_NAMES_LOWER:
        code = _SUPPORTED_LANGUAGE_NAMES_LOWER[key]
        return code, _LANG_NAMES[code]

    raise HTTPException(
        status_code=400,
        detail={
            "error": "unsupported_target_language",
            "message": f"Unsupported target_language: {raw}",
            "supported": sorted(_SUPPORTED_LANGUAGE_CODES),
        },
    )


def _set_last_error(message: str) -> None:
    global _last_error, _last_error_at
    _last_error = message
    _last_error_at = time.time()


# ---------------------------------------------------------------------------
# Oracle helper
# ---------------------------------------------------------------------------

ORACLE_URL = "http://localhost:8888/oracle/chat"


async def _call_oracle(prompt: str, system: str) -> str:
    """Call the Oracle (L5) via async HTTP, with strict timeout."""
    timeout = httpx.Timeout(ORACLE_TIMEOUT_S, connect=0.5)
    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.post(
            ORACLE_URL,
            json={"prompt": prompt, "system": system, "priority": "high"},
        )
        resp.raise_for_status()
        data = resp.json()
        return data.get("response", data.get("text", str(data)))


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("/status")
async def polyglot_status():
    return {
        "success": True,
        "level": 28,
        "name": "Polyglot",
        "status": "active",
        "total_requests": _total_requests,
        "translations_count": _translations_count,
        "detections_count": _detections_count,
        "timeout_count": _timeout_count,
        "oracle_error_count": _oracle_error_count,
        "last_error": _last_error,
        "last_error_at": _last_error_at,
        "limits": {
            "max_text_chars": MAX_TEXT_CHARS,
            "max_batch_items": MAX_BATCH_ITEMS,
            "oracle_timeout_s": ORACLE_TIMEOUT_S,
        },
        "languages": sorted(_SUPPORTED_LANGUAGE_CODES),
        "capabilities": ["translation", "language_detection", "languages", "batch_translation"],
    }


@router.get("/languages")
async def polyglot_languages():
    return {
        "success": True,
        "languages": [{"code": code, "name": _LANG_NAMES[code]} for code in sorted(_SUPPORTED_LANGUAGE_CODES)],
    }


@router.post("/translate", response_model=TranslateResponse)
async def translate_text(request: TranslateRequest):
    global _translations_count, _total_requests, _timeout_count, _oracle_error_count
    _total_requests += 1

    code, target_name = _normalize_language(request.target_language)

    source = request.source_language
    if source is None:
        source_code, _ = _detect_language_heuristic(request.text)
        source = _LANG_NAMES.get(source_code, source_code)

    system_prompt = (
        "You are a professional translator. Translate the given text accurately. "
        "Provide ONLY the translation, nothing else. No explanations, no notes, "
        "no quotation marks around the translation."
    )
    user_prompt = (
        f"Translate the following text to {target_name}. "
        "Provide ONLY the translation, nothing else.\n\n"
        f"{request.text}"
    )

    try:
        translated = await asyncio.wait_for(_call_oracle(user_prompt, system_prompt), timeout=ORACLE_TIMEOUT_S + 0.1)
        translated = translated.strip().strip("\"").strip("'")
        _translations_count += 1
        return TranslateResponse(
            success=True,
            original_text=request.text,
            translated_text=translated,
            target_language=code,
            source_language=source,
            method="oracle",
        )
    except (asyncio.TimeoutError, httpx.TimeoutException):
        _timeout_count += 1
        _oracle_error_count += 1
        _set_last_error("oracle_timeout")
        return TranslateResponse(
            success=False,
            original_text=request.text,
            translated_text=request.text,
            target_language=code,
            source_language=source,
            error=f"Oracle timed out (~{ORACLE_TIMEOUT_S}s cap).",
            method="fallback",
        )
    except Exception as e:
        _oracle_error_count += 1
        _set_last_error(f"translation_error: {type(e).__name__}: {e}")
        return TranslateResponse(
            success=False,
            original_text=request.text,
            translated_text=request.text,
            target_language=code,
            source_language=source,
            error=f"Translation error: {type(e).__name__}",
            method="fallback",
        )


@router.post("/translate/batch", response_model=TranslateBatchResponse)
async def translate_batch(request: TranslateBatchRequest):
    global _total_requests
    _total_requests += 1

    code, _ = _normalize_language(request.target_language)

    if len(request.texts) > MAX_BATCH_ITEMS:
        raise HTTPException(status_code=400, detail=f"Too many texts; max {MAX_BATCH_ITEMS}")

    results: list[TranslateResponse] = []
    for t in request.texts:
        if not t or not t.strip():
            results.append(
                TranslateResponse(
                    success=False,
                    original_text=t,
                    translated_text=t,
                    target_language=code,
                    source_language=request.source_language,
                    error="Empty text",
                    method="validation",
                )
            )
            continue
        if len(t) > MAX_TEXT_CHARS:
            results.append(
                TranslateResponse(
                    success=False,
                    original_text=t,
                    translated_text=t,
                    target_language=code,
                    source_language=request.source_language,
                    error=f"Text too long (>{MAX_TEXT_CHARS} chars)",
                    method="validation",
                )
            )
            continue

        results.append(
            await translate_text(
                TranslateRequest(text=t, target_language=request.target_language, source_language=request.source_language)
            )
        )

    return TranslateBatchResponse(
        success=True,
        target_language=code,
        source_language=request.source_language,
        results=results,
    )


@router.post("/detect", response_model=DetectResponse)
async def detect_language(request: DetectRequest):
    global _detections_count, _total_requests, _timeout_count, _oracle_error_count
    _total_requests += 1
    _detections_count += 1

    sample = request.text[:80] + ("…" if len(request.text) > 80 else "")

    heuristic_lang, heuristic_conf = _detect_language_heuristic(request.text)
    heuristic_name = _LANG_NAMES.get(heuristic_lang, heuristic_lang)

    if heuristic_conf >= 0.5:
        return DetectResponse(
            success=True,
            text_sample=sample,
            detected_language=heuristic_name,
            confidence=heuristic_conf,
            method="heuristic (high confidence)",
        )

    try:
        system_prompt = "You are a language identification expert."
        snippet = request.text[:MAX_DETECT_CHARS_FOR_ORACLE]
        user_prompt = (
            "What language is this text written in? "
            "Respond with just the language name, nothing else.\n\n"
            f"{snippet}"
        )
        oracle_answer = await asyncio.wait_for(_call_oracle(user_prompt, system_prompt), timeout=ORACLE_TIMEOUT_S + 0.1)
        oracle_lang = oracle_answer.strip().strip(".").strip()

        combined_confidence = min(0.9, heuristic_conf + 0.4)
        return DetectResponse(
            success=True,
            text_sample=sample,
            detected_language=oracle_lang,
            confidence=combined_confidence,
            method=f"oracle+heuristic (heuristic suggested: {heuristic_name} @ {heuristic_conf})",
        )
    except (asyncio.TimeoutError, httpx.TimeoutException):
        _timeout_count += 1
        _oracle_error_count += 1
        _set_last_error("oracle_timeout")
        return DetectResponse(
            success=True,
            text_sample=sample,
            detected_language=heuristic_name,
            confidence=heuristic_conf,
            method="heuristic (oracle timeout)",
        )
    except Exception as e:
        _oracle_error_count += 1
        _set_last_error(f"detect_error: {type(e).__name__}: {e}")
        return DetectResponse(
            success=True,
            text_sample=sample,
            detected_language=heuristic_name,
            confidence=heuristic_conf,
            method="heuristic (oracle unavailable)",
            error=f"Oracle error: {type(e).__name__}",
        )
