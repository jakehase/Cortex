"""ExecutionEngine adapter for L35 Singularity: model-backed code review.

Reviews inline code only: ``context["code"]`` or the first fenced code block in
the user's message. File paths are never read from the adapter path.
"""

from __future__ import annotations

import re
from typing import Any, Dict, Mapping

from cortex_server.modules import singularity as review_core
from cortex_server.modules.execution_engine import ExecutionBlocked

LEVEL = 35
NAME = "singularity"
NEEDS_MODEL = True
SAFE_AUTORUN = True  # reads only the supplied text; never executes or writes code
DEFAULT_DEADLINE_S = 65.0

_FENCE = re.compile(r"```[A-Za-z0-9_+.-]*[ \t]*\n(.*?)```", re.S)


def extract_code(query: str, context: Mapping[str, Any]) -> str:
    code = str((context or {}).get("code") or "")
    if code.strip():
        return code
    match = _FENCE.search(str(query or ""))
    return match.group(1) if match else ""


async def run(query: str, context: Mapping[str, Any]) -> Dict[str, Any]:
    scope = str((context or {}).get("principal_scope_key") or "").strip()
    if not scope:
        raise ExecutionBlocked("missing_principal_scope")
    code = extract_code(query, context)
    if not code.strip():
        raise ExecutionBlocked("no_code_supplied")
    if len(code) > review_core.MAX_CODE_CHARS:
        raise ExecutionBlocked("code_too_large")
    analysis = await review_core.review_code(
        code, source_label="inline code", scope="full", principal_scope_key=scope,
    )
    if not analysis.get("ok"):
        raise ExecutionBlocked(str(analysis.get("model_status") or "model_unavailable"))
    findings = analysis["findings"][:5]
    lines = [f"- [{f['severity']}/{f['category']}] line {f['line']}: {f['description']} Fix: {f['suggestion']}"
             for f in findings]
    summary = analysis["summary"] + ("\n" + "\n".join(lines) if lines else "")
    return {
        "operation": "singularity.review",
        "origin": "model",
        "summary": summary[:1500],
        "data": {
            "mode": "model",
            "findings": findings,
            "static_findings": analysis["static_findings"][:5],
            "static_checks": analysis["static_checks"],
            "findings_dropped_unverified": analysis.get("findings_dropped_unverified", 0),
        },
        "model": analysis.get("model"),
        "receipt_id": analysis.get("receipt_id"),
        "elapsed_ms": analysis.get("elapsed_ms"),
    }
