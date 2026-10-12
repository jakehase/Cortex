"""Polyglot Router - API endpoints for L28 Polyglot (model-backed).

- Translation and language detection are done by a receipt-verified model call
  through ``modules.level_model`` (in-process OpenClaw lane, principal-scoped,
  ephemeral session). The unauthenticated 1.25 s HTTP hop to ``/oracle/chat``
  is gone.
- Any BCP-47 code or language name is accepted; the model reports the codes it
  actually used and flags unsupported targets.
- Honest failures: when the model is unavailable, ``/translate`` returns
  ``success: false`` and ``translated_text: null`` (the source is never echoed
  as a translation); ``/detect`` returns ``success: false`` and at most a
  clearly labelled Unicode-script hint (never a Latin-script language guess).
- Batch ``success`` is true only when every item succeeded.
- ``/status`` reports measured health from recent real calls.
"""

from __future__ import annotations

import asyncio
import time
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from cortex_server.modules import polyglot as polyglot_core
from cortex_server.modules.level_router_support import (
    model_lane_readiness,
    principal_scope_for_request,
)

router = APIRouter()

MAX_TEXT_CHARS = polyglot_core.MAX_TEXT_CHARS
MAX_BATCH_ITEMS = 10
BATCH_CONCURRENCY = 3
BATCH_BUDGET_S = polyglot_core.POLYGLOT_DEADLINE_S
_MIN_ITEM_BUDGET_S = 3.0

_total_requests: int = 0


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
    translated_text: Optional[str] = None
    target_language: str
    source_language: Optional[str] = None
    target_language_name: Optional[str] = None
    source_language_name: Optional[str] = None
    error: Optional[str] = None
    method: str = "model"
    origin: str = "model_unavailable"
    operation: str = "polyglot.translate"
    notes: Optional[str] = None
    model: Optional[str] = None
    receipt_id: Optional[str] = None
    model_status: Optional[str] = None
    elapsed_ms: Optional[int] = None
    label: Optional[str] = None


class DetectRequest(BaseModel):
    """Request body for language detection."""

    text: str = Field(..., min_length=1, max_length=MAX_TEXT_CHARS)


class DetectResponse(BaseModel):
    success: bool
    text_sample: str
    detected_language: Optional[str] = None
    language_code: Optional[str] = None
    # Deprecated numeric confidence: the model reports a calibrated label
    # (confidence_label); no invented decimals are produced, so this is null.
    confidence: Optional[float] = None
    confidence_label: Optional[str] = None
    reliable: bool = False
    script: Optional[str] = None
    alternatives: List[Dict[str, str]] = Field(default_factory=list)
    method: str
    origin: str = "model_unavailable"
    operation: str = "polyglot.detect"
    error: Optional[str] = None
    fallback: Optional[Dict[str, Any]] = None
    model: Optional[str] = None
    receipt_id: Optional[str] = None
    model_status: Optional[str] = None
    elapsed_ms: Optional[int] = None
    label: Optional[str] = None


class TranslateBatchRequest(BaseModel):
    texts: list[str] = Field(..., min_length=1, max_length=MAX_BATCH_ITEMS)
    target_language: str = Field(..., min_length=1, max_length=64)
    source_language: Optional[str] = Field(None, max_length=64)


class TranslateBatchResponse(BaseModel):
    success: bool
    target_language: str
    source_language: Optional[str]
    results: list[TranslateResponse]
    succeeded: int = 0
    failed: int = 0
    error: Optional[str] = None


def _fields(model_cls: type[BaseModel], payload: Dict[str, Any]) -> Dict[str, Any]:
    return {k: v for k, v in payload.items() if k in model_cls.model_fields}


def _target_or_400(raw: str) -> tuple[str, str]:
    try:
        return polyglot_core.normalize_target(raw)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "invalid_target_language",
                "message": "target_language must be a BCP-47 code (e.g. 'es', 'pt-BR') or a language name",
            },
        )


def _validation_item(text: str, target: str, source: Optional[str], error: str) -> TranslateResponse:
    return TranslateResponse(
        success=False,
        original_text=text,
        translated_text=None,
        target_language=target,
        source_language=source,
        error=error,
        method="validation",
        origin="validation",
    )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("/status")
async def polyglot_status():
    lane = model_lane_readiness()
    outcomes = polyglot_core.OUTCOMES.snapshot()
    counts = polyglot_core.counters()
    return {
        "success": True,
        "level": 28,
        "name": "Polyglot",
        "status": polyglot_core.OUTCOMES.health(lane),
        "model_backed": True,
        "model_lane": lane,
        "recent_outcomes": outcomes,
        "total_requests": _total_requests,
        "translations_count": counts["translations"],
        "detections_count": counts["detections"],
        "oracle_error_count": counts["errors"],
        "model_error_count": counts["errors"],
        "heuristic_fallback_count": counts["heuristic_fallbacks"],
        "last_error": outcomes["last_error"],
        "last_error_at": outcomes["last_error_at"],
        "limits": {
            "max_text_chars": MAX_TEXT_CHARS,
            "max_batch_items": MAX_BATCH_ITEMS,
            "model_deadline_s": polyglot_core.POLYGLOT_DEADLINE_S,
            "batch_budget_s": BATCH_BUDGET_S,
        },
        "languages": "any BCP-47 code or language name (model-resolved); see /polyglot/languages for common ones",
        "capabilities": ["translation", "language_detection", "languages", "batch_translation"],
        "fallback": "detect only: labelled Unicode-script hint with success:false; translate: none",
    }


@router.get("/languages")
async def polyglot_languages():
    return {
        "success": True,
        "kind": "common_examples",
        "accepts": "any BCP-47 code or English language name; the model reports unsupported targets",
        "languages": [
            {"code": code, "name": name} for code, name in sorted(polyglot_core.COMMON_LANGUAGES.items())
        ],
    }


async def _translate(
    request: TranslateRequest,
    http_request: Any,
    deadline_s: Optional[float] = None,
) -> TranslateResponse:
    _target_or_400(request.target_language)
    scope = principal_scope_for_request(http_request, polyglot_core.NAME)
    try:
        payload = await polyglot_core.translate(
            request.text,
            request.target_language,
            principal_scope_key=scope,
            source_language=request.source_language,
            deadline_s=deadline_s,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return TranslateResponse(**_fields(TranslateResponse, payload))


@router.post("/translate", response_model=TranslateResponse)
async def translate_text(request: TranslateRequest, http_request: Request = None):  # type: ignore[assignment]
    global _total_requests
    _total_requests += 1
    return await _translate(request, http_request)


@router.post("/translate/batch", response_model=TranslateBatchResponse)
async def translate_batch(request: TranslateBatchRequest, http_request: Request = None):  # type: ignore[assignment]
    global _total_requests
    _total_requests += 1

    code, _ = _target_or_400(request.target_language)
    if len(request.texts) > MAX_BATCH_ITEMS:
        raise HTTPException(status_code=400, detail=f"Too many texts; max {MAX_BATCH_ITEMS}")

    started = time.monotonic()
    sem = asyncio.Semaphore(BATCH_CONCURRENCY)

    async def one(text: str) -> TranslateResponse:
        if not text or not text.strip():
            return _validation_item(text, code, request.source_language, "Empty text")
        if len(text) > MAX_TEXT_CHARS:
            return _validation_item(text, code, request.source_language, f"Text too long (>{MAX_TEXT_CHARS} chars)")
        async with sem:
            remaining = BATCH_BUDGET_S - (time.monotonic() - started)
            if remaining < _MIN_ITEM_BUDGET_S:
                return TranslateResponse(
                    success=False, original_text=text, translated_text=None, target_language=code,
                    source_language=request.source_language, error="batch_deadline_exceeded",
                    method="model_unavailable", origin="model_unavailable",
                )
            return await _translate(
                TranslateRequest(text=text, target_language=request.target_language,
                                 source_language=request.source_language),
                http_request,
                deadline_s=remaining,
            )

    results = list(await asyncio.gather(*(one(t) for t in request.texts)))
    succeeded = sum(1 for r in results if r.success)
    failed = len(results) - succeeded
    return TranslateBatchResponse(
        success=failed == 0,
        target_language=code,
        source_language=request.source_language,
        results=results,
        succeeded=succeeded,
        failed=failed,
        error=None if failed == 0 else f"{failed} of {len(results)} items failed",
    )


@router.post("/detect", response_model=DetectResponse)
async def detect_language(request: DetectRequest, http_request: Request = None):  # type: ignore[assignment]
    global _total_requests
    _total_requests += 1
    scope = principal_scope_for_request(http_request, polyglot_core.NAME)
    try:
        payload = await polyglot_core.detect(request.text, principal_scope_key=scope)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return DetectResponse(**_fields(DetectResponse, payload))
