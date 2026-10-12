"""ExecutionEngine adapter for L28 Polyglot: language ID and translation.

If the engine supplies ``context["target_language"]`` the message (or
``context["text"]``) is translated to it; otherwise one model call identifies
the message language and, if the message asks for a translation, performs it.
No heuristic is used here: model unavailable -> ``ExecutionBlocked``.
"""

from __future__ import annotations

from typing import Any, Dict, Mapping

from cortex_server.modules import polyglot as polyglot_core
from cortex_server.modules.execution_engine import ExecutionBlocked
from cortex_server.modules.level_router_support import adapter_context_text, adapter_scope, clip

LEVEL = 28
NAME = "polyglot"
NEEDS_MODEL = True
SAFE_AUTORUN = True  # read-only: one model call, no egress beyond the model lane
DEFAULT_DEADLINE_S = 40.0


async def run(query: str, context: Mapping[str, Any]) -> Dict[str, Any]:
    ctx = context or {}
    scope = adapter_scope(ctx)
    if not scope:
        raise ExecutionBlocked("missing_principal_scope")
    text = str(ctx.get("text") or query or "").strip()
    if not text:
        raise ExecutionBlocked("empty_query")
    deadline = DEFAULT_DEADLINE_S - 3.0
    target = str(ctx.get("target_language") or "").strip()

    if target:
        try:
            result = await polyglot_core.translate(
                text[: polyglot_core.MAX_TEXT_CHARS], target, principal_scope_key=scope, deadline_s=deadline
            )
        except ValueError as exc:
            raise ExecutionBlocked(str(exc)) from exc
        if not result.get("success"):
            reason = result.get("error") if result.get("origin") == "model" else result.get("model_status")
            raise ExecutionBlocked(str(reason or "model_unavailable"))
        return {
            "operation": "polyglot.translate",
            "origin": "model",
            "summary": clip(
                f"Translation ({result.get('source_language')} -> {result.get('target_language')}): "
                f"{result.get('translated_text')}",
                1500,
            ),
            "data": {
                "source_language": result.get("source_language"),
                "target_language": result.get("target_language"),
                "translation": clip(result.get("translated_text"), 3000),
                "notes": result.get("notes"),
            },
            "model": result.get("model"),
            "receipt_id": result.get("receipt_id"),
            "elapsed_ms": result.get("elapsed_ms"),
        }

    result = await polyglot_core.assist(
        text, principal_scope_key=scope, context=adapter_context_text(ctx, 2000) or None, deadline_s=deadline
    )
    if not result.get("success"):
        raise ExecutionBlocked(str(result.get("model_status") or result.get("status") or "model_unavailable"))
    summary = (
        f"Message language: {result.get('message_language_name')} ({result.get('message_language')}, "
        f"confidence {result.get('confidence')})."
    )
    if result.get("translation_requested"):
        src = result.get("source_language_name") or result.get("source_language") or "unknown language"
        dst = result.get("target_language_name") or result.get("target_language")
        summary += f" Requested translation ({src} -> {dst}): {result.get('translation')}"
    return {
        "operation": "polyglot.translate" if result.get("translation_requested") else "polyglot.detect",
        "origin": "model",
        "summary": clip(summary, 1500),
        "data": {
            "message_language": result.get("message_language"),
            "message_language_name": result.get("message_language_name"),
            "confidence": result.get("confidence"),
            "translation_requested": bool(result.get("translation_requested")),
            "source_text": clip(result.get("source_text"), 1000) if result.get("source_text") else None,
            "source_language": result.get("source_language"),
            "source_language_name": result.get("source_language_name"),
            "target_language": result.get("target_language"),
            "translation": clip(result.get("translation"), 3000) if result.get("translation") else None,
            "notes": result.get("notes"),
        },
        "model": result.get("model"),
        "receipt_id": result.get("receipt_id"),
        "elapsed_ms": result.get("elapsed_ms"),
    }
