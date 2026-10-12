"""L34 Validator adapter: deterministic schema / JSON well-formedness checks.

Input is ``context["validation_target"] = {"schema": <name or inline schema>,
"data": <json>, "strict": bool}`` (normally supplied by another level). Without
a target, a JSON object/array embedded in the user's message is checked for
well-formedness. Otherwise there is nothing to validate and the adapter is
blocked rather than inventing a verdict.
"""

from __future__ import annotations

import json
from typing import Any, Dict, Mapping, Optional

from cortex_server.modules.execution_engine import ExecutionBlocked

LEVEL = 34
NAME = "validator"
NEEDS_MODEL = False
SAFE_AUTORUN = True
DEFAULT_DEADLINE_S = 1.0
MAX_EMBEDDED_JSON_CHARS = 200_000


def _embedded_json(query: str) -> Optional[str]:
    text = str(query or "")
    starts = [i for i in (text.find("{"), text.find("[")) if i >= 0]
    if not starts:
        return None
    start = min(starts)
    closer = "}" if text[start] == "{" else "]"
    end = text.rfind(closer)
    if end <= start:
        return text[start:start + MAX_EMBEDDED_JSON_CHARS]
    return text[start:end + 1][:MAX_EMBEDDED_JSON_CHARS]


async def run(query: str, context: Mapping[str, Any]) -> Dict[str, Any]:
    from cortex_server.modules.validator import SchemaDefinitionError
    from cortex_server.routers.validator import validate_payload

    target = context.get("validation_target") if isinstance(context, Mapping) else None
    if isinstance(target, Mapping) and "data" in target and target.get("schema") is not None:
        strict = target.get("strict", True) is not False
        try:
            result = validate_payload(target["schema"], target["data"], strict=strict)
        except SchemaDefinitionError as exc:
            raise ExecutionBlocked("invalid_schema_definition") from exc
        errors = result.get("errors") or []
        summary = (
            f"Validation against schema '{result.get('schema')}' ({result.get('mode')} mode): "
            f"{'VALID' if result.get('valid') else 'INVALID'}; {len(errors)} error(s)"
            + (f", e.g. {errors[0]['message']}" if errors else "")
            + ("; passes strictly too." if result.get("strict_valid") else "; would fail strict mode." if result.get("valid") else ".")
        )
        return {
            "operation": "validator.validate",
            "origin": "deterministic",
            "summary": summary[:1500],
            "data": {
                "valid": result.get("valid"),
                "mode": result.get("mode"),
                "strict_valid": result.get("strict_valid"),
                "error_count": len(errors),
                "errors": errors[:20],
                "warnings": (result.get("warnings") or [])[:20],
                "schema": result.get("schema"),
            },
        }

    blob = _embedded_json(query)
    if blob is None:
        raise ExecutionBlocked("no_validation_target")
    try:
        parsed = json.loads(blob)
    except json.JSONDecodeError as exc:
        return {
            "operation": "validator.json_syntax",
            "origin": "deterministic",
            "summary": f"The JSON in the message is NOT well-formed: {exc.msg} at line {exc.lineno} column {exc.colno}.",
            "data": {"well_formed": False, "error": exc.msg, "line": exc.lineno, "column": exc.colno},
        }
    kind = "object" if isinstance(parsed, dict) else "array" if isinstance(parsed, list) else type(parsed).__name__
    size = len(parsed) if isinstance(parsed, (dict, list)) else None
    return {
        "operation": "validator.json_syntax",
        "origin": "deterministic",
        "summary": (
            f"The JSON in the message is well-formed ({kind}"
            + (f" with {size} top-level entries" if size is not None else "")
            + "). No schema was supplied, so only syntax was checked."
        ),
        "data": {
            "well_formed": True,
            "top_level_type": kind,
            "top_level_size": size,
            "top_level_keys": sorted(parsed.keys())[:50] if isinstance(parsed, dict) else None,
        },
    }
