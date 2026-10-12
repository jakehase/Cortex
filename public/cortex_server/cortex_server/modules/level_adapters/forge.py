"""ExecutionEngine adapter for L27 Forge: review a Python code block from the
message (static checks + model review), or generate an honest 501 scaffold
from an explicit spec. Never proposes, approves or commits."""

from __future__ import annotations

import re
from typing import Any, Dict, Mapping

from cortex_server.modules.execution_engine import ExecutionBlocked
from cortex_server.modules.level_adapters._safe_level_common import (
    clip,
    code_blocks,
    require_query,
    strip_code_blocks,
)

LEVEL = 27
NAME = "forge"
NEEDS_MODEL = False  # scaffold generation is deterministic; review uses the model when available
SAFE_AUTORUN = True  # generates/reviews text only; disk writes need /forge/propose→approve→commit
DEFAULT_DEADLINE_S = 70.0

_ENDPOINT = re.compile(r"\b(GET|POST|PUT|PATCH|DELETE)\s+(/[A-Za-z0-9_\-/{}]*)")
_NAME = re.compile(r"\b(?:level|router|module|service)\s+(?:called|named)\s+[\"']?([A-Za-z0-9 _-]{2,60}?)[\"']?(?:[.,;:!?]|\s+(?:with|that|for)\b|$)", re.I)
_SCAFFOLD_INTENT = re.compile(r"\b(scaffold|skeleton|boilerplate|stub|generate|create)\b", re.I)
# "Scaffold a router for tracking prior authorizations" -> "prior authorizations".
_PURPOSE_NAME = re.compile(
    r"\b(?:level|router|module|service|api|endpoint)s?\s+(?:for|to)\s+"
    r"(?:(?:track|manag|handl|stor|process|log|monitor)(?:e|es|ing|s)?\s+)?"
    r"(?:the\s+|our\s+|my\s+)?([A-Za-z][A-Za-z0-9 _-]{1,58}?)\s*(?:[.,;:!?]|\s+(?:with|that|which|using)\b|$)",
    re.I,
)


def _derive_name(text: str) -> str:
    for pattern in (_NAME, _PURPOSE_NAME):
        match = pattern.search(text)
        if match:
            name = re.sub(r"\s+", " ", match.group(1)).strip(" _-")
            if 2 <= len(name) <= 60:
                return name
    return ""


def _default_resource_endpoints(name: str) -> list:
    """Conventional list/create/read/update routes for a tracking-style router.

    Used only when the message names a purpose but no routes; every one is a
    501 stub in the generated scaffold and is reported as inferred.
    """

    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") or "items"
    return [f"GET /{slug}", f"POST /{slug}", f"GET /{slug}/{{item_id}}", f"PATCH /{slug}/{{item_id}}"]


async def run(query: str, context: Mapping[str, Any]) -> Dict[str, Any]:
    from fastapi import HTTPException

    from cortex_server.routers import forge as forge_router

    text = require_query(query)
    scope = str(context.get("principal_scope_key") or "").strip()
    blocks = [b for b in code_blocks(text) if b["language"] in {"python", ""}]
    generated = None
    endpoints_inferred = False
    if blocks:
        code = blocks[0]["code"]
        intent = clip(strip_code_blocks(text), 500)
    else:
        name = str(context.get("level_name") or "").strip()
        if not name:
            name = _derive_name(strip_code_blocks(text))
        endpoints = list(context.get("endpoints") or []) or [f"{m} {p}" for m, p in _ENDPOINT.findall(text)]
        if not (_SCAFFOLD_INTENT.search(text) and name):
            raise ExecutionBlocked("no_code_block_or_scaffold_spec")
        endpoints_inferred = not endpoints
        if endpoints_inferred:
            endpoints = _default_resource_endpoints(name)
        try:
            generated = forge_router._validated_generate(forge_router.GenerateRequest(
                level_number=int(context.get("level_number") or 0),
                level_name=name,
                description=clip(strip_code_blocks(text), 1500),
                endpoints=endpoints[:25] or None,
                template=str(context.get("template") or "standard_router"),
            ))
        except HTTPException as exc:
            raise ExecutionBlocked("invalid_scaffold_spec") from exc
        code = generated.code
        intent = clip(text, 500)
    review = None
    if scope and scope != "internal-system":
        review = await forge_router.review_code(code, intent=intent, principal_scope_key=scope)
    static = (review or {}).get("static_checks") or forge_router.static_scaffold_checks(code)
    model_review = (review or {}).get("review") if review and review.get("success") else None
    parts = []
    if generated is not None:
        parts.append(f"Generated scaffold {generated.filename} ({generated.lines} lines); "
                     f"stub endpoints returning 501: {', '.join(generated.not_implemented_endpoints) or 'none'}"
                     + (" (routes inferred: no routes were specified)" if endpoints_inferred else ""))
    parts.append(
        f"static: syntax_ok={static.get('syntax_ok')}, fake-success stubs at lines {static.get('fake_success_stubs_at_lines') or []}, "
        f"{len(static.get('risk_findings') or [])} risk findings"
    )
    if model_review:
        parts.append(f"review verdict {model_review['verdict']}: {clip(model_review['summary'], 400)}")
    elif review is not None:
        parts.append("model review unavailable (static checks only)")
    return {
        "operation": "forge.scaffold" if generated is not None else "forge.review",
        "origin": "model" if model_review else "deterministic",
        "summary": clip("Forge: " + " | ".join(parts), 1500),
        "data": {
            "scaffold": None if generated is None else {
                "filename": generated.filename,
                "lines": generated.lines,
                "code_sha256": generated.code_sha256,
                "code_preview": "\n".join(generated.code.splitlines()[:120]),
                "not_implemented_endpoints": generated.not_implemented_endpoints,
                "endpoints_inferred": endpoints_inferred,
            },
            "static_checks": {k: static.get(k) for k in ("syntax_ok", "routes", "not_implemented_endpoints",
                                                       "fake_success_stubs_at_lines", "static_check_passed")},
            "review": None if not model_review else {
                "verdict": model_review["verdict"],
                "risks": model_review.get("risks", [])[:5],
                "missing_tests": model_review.get("missing_tests", [])[:5],
                "implementation_gaps": model_review.get("implementation_gaps", [])[:5],
            },
            "written_to_disk": False,
        },
        "model": (review or {}).get("model") if model_review else None,
        "receipt_id": (review or {}).get("receipt_id") if model_review else None,
    }
