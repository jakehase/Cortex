"""Level 34 Validator: deterministic schema validation.

Validation is delegated to ``modules.validator.validate_json`` (legacy flat
schemas plus a JSON-Schema subset; booleans are never integers/numbers).
Custom schemas are validated at registration, so a stored schema can never
make ``/validate`` fail with a 500. Every response states the mode used
(``strict`` or ``lenient``) and whether the data would also pass strictly.
"""

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from cortex_server.modules.validator import (
    SchemaDefinitionError,
    schema_sha256,
    self_test,
    split_messages,
    validate_json,
    validate_schema_definition,
)

router = APIRouter(tags=["Validator"])

MAX_CUSTOM_SCHEMAS = 256

validator_state = {
    "validations": 0,
    "failures": 0,
    "unknown_schema_failures": 0,
    "type_mismatch_failures": 0,
    "strict_validations": 0,
    "lenient_validations": 0,
    "lenient_passes_with_warnings": 0,
    "rejected_schema_registrations": 0,
}

# Predefined schemas (legacy flat format).
BUILTIN_SCHEMAS = {
    "user_request": {
        "required_fields": ["action", "user_id"],
        "field_types": {"action": "string", "user_id": "string", "params": "object"}
    },
    "api_response": {
        "required_fields": ["success", "data"],
        "field_types": {"success": "boolean", "data": "any", "error": "string"}
    },
    "event_log": {
        "required_fields": ["timestamp", "level", "message"],
        "field_types": {"timestamp": "string", "level": "string", "message": "string"}
    }
}
# Name -> schema as registered/defined (kept for listing compatibility).
SCHEMAS: Dict[str, Dict[str, Any]] = {name: dict(defn) for name, defn in BUILTIN_SCHEMAS.items()}
# Name -> validated, normalised JSON-Schema-subset form used for evaluation.
_COMPILED: Dict[str, Dict[str, Any]] = {
    name: validate_schema_definition(defn) for name, defn in BUILTIN_SCHEMAS.items()
}

# Legacy label map kept for importers; booleans are excluded from numbers.
TYPE_MAP = {
    "string": (str,),
    "boolean": (bool,),
    "number": (int, float),
    "integer": (int,),
    "object": (dict,),
    "array": (list,),
    "any": (object,),
}


class ValidateRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    data: Any = Field(..., description="JSON value to validate")
    schema_name: Optional[str] = Field(default=None, alias="schema", max_length=128)
    schema_definition: Optional[Dict[str, Any]] = Field(
        default=None, description="Inline schema (legacy flat or JSON-Schema subset) instead of a named one"
    )
    strict: bool = Field(default=True, strict=True)


class SchemaRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=128)
    definition: Dict[str, Any]


class ValidatorResponse(BaseModel):
    success: bool
    data: dict
    error: Optional[str] = None


def _resolve_schema(request: ValidateRequest) -> tuple[Optional[str], Optional[Dict[str, Any]], Optional[str]]:
    if request.schema_definition is not None:
        try:
            return "inline", validate_schema_definition(request.schema_definition), None
        except SchemaDefinitionError as exc:
            raise HTTPException(status_code=422, detail=f"invalid schema_definition: {exc}") from exc
    if not request.schema_name:
        raise HTTPException(status_code=422, detail="schema (name) or schema_definition is required")
    compiled = _COMPILED.get(request.schema_name)
    if compiled is None:
        return request.schema_name, None, f"Unknown schema: {request.schema_name}"
    return request.schema_name, compiled, None


@router.post("/validate")
async def validate_data(request: ValidateRequest):
    validator_state["validations"] += 1
    mode_key = "strict_validations" if request.strict else "lenient_validations"
    validator_state[mode_key] += 1
    name, compiled, unknown = _resolve_schema(request)
    if compiled is None:
        validator_state["failures"] += 1
        validator_state["unknown_schema_failures"] += 1
        return {
            "valid": False,
            "mode": "strict" if request.strict else "lenient",
            "strict_valid": False,
            "errors": [unknown],
            "warnings": [],
            "error_details": [{"path": "$", "rule": "schema", "message": unknown}],
            "schema": name,
        }

    try:
        result = validate_json(compiled, request.data, strict=request.strict)
    except Exception as exc:  # defensive: compiled schemas are pre-validated
        raise HTTPException(status_code=422, detail=f"schema could not be evaluated ({type(exc).__name__})") from exc

    errors, warnings = split_messages(result)
    if not result["valid"]:
        validator_state["failures"] += 1
        if any(row["rule"] == "type" for row in result["errors"]):
            validator_state["type_mismatch_failures"] += 1
    elif result["warnings"]:
        validator_state["lenient_passes_with_warnings"] += 1

    return {
        "valid": result["valid"],
        "mode": result["mode"],
        "strict_valid": result["strict_valid"],
        "errors": errors,
        "warnings": warnings,
        "error_details": result["errors"],
        "warning_details": result["warnings"],
        "truncated": result["truncated"],
        "schema": name,
        "schema_sha256": schema_sha256(compiled),
    }


@router.post("/schema")
async def create_schema(request: SchemaRequest):
    if request.name in BUILTIN_SCHEMAS:
        return {"created": False, "error": "reserved_schema_name"}
    if not request.name.startswith("custom_"):
        return {"created": False, "error": "schema_name_must_start_with_custom_"}
    try:
        compiled = validate_schema_definition(request.definition)
    except SchemaDefinitionError as exc:
        validator_state["rejected_schema_registrations"] += 1
        raise HTTPException(status_code=422, detail=f"invalid schema definition: {exc}") from exc
    if request.name not in SCHEMAS and len(SCHEMAS) - len(BUILTIN_SCHEMAS) >= MAX_CUSTOM_SCHEMAS:
        raise HTTPException(status_code=409, detail="custom schema limit reached")

    replaced = request.name in SCHEMAS
    SCHEMAS[request.name] = dict(request.definition)
    _COMPILED[request.name] = compiled
    return {
        "created": True,
        "replaced": replaced,
        "name": request.name,
        "fields": len(compiled.get("required") or []),
        "schema_sha256": schema_sha256(compiled),
        "scope": "process_local_shared",
        "durable": False,
    }


@router.get("/schemas")
async def list_schemas():
    return ValidatorResponse(
        success=True,
        data={
            "schemas": list(SCHEMAS.keys()),
            "count": len(SCHEMAS),
            "builtin": list(BUILTIN_SCHEMAS.keys()),
            "custom_scope": "process_local_shared_not_durable",
        },
        error=None
    )


@router.get("/status")
async def validator_status():
    test = self_test()
    validations = validator_state["validations"]
    return ValidatorResponse(
        success=test["passed"],
        data={
            "level": 34, "name": "The Validator",
            "status": "active" if test["passed"] else "degraded",
            "self_test": test,
            "strict_default": True,
            "strict_overridable_per_request": True,
            "supported_formats": ["legacy_flat", "json_schema_subset"],
            **{key: value for key, value in validator_state.items()},
            "success_rate": round(1 - (validator_state["failures"] / max(1, validations)), 2) if validations else None,
            "counters_scope": "since_boot_per_worker",
            "available_schemas": list(SCHEMAS.keys()),
            "custom_schema_scope": "process_local_shared_not_durable",
        },
        error=None if test["passed"] else "self_test_failed"
    )


def validate_payload(schema: Any, data: Any, *, strict: bool = True) -> Dict[str, Any]:
    """In-process entry point for other levels (named or inline schema)."""

    if isinstance(schema, str):
        compiled = _COMPILED.get(schema)
        if compiled is None:
            return {"valid": False, "mode": "strict" if strict else "lenient", "errors": [
                {"path": "$", "rule": "schema", "message": f"Unknown schema: {schema}"}], "warnings": [],
                "strict_valid": False, "schema": schema}
        result = validate_json(compiled, data, strict=strict)
        return {**result, "schema": schema}
    compiled = validate_schema_definition(schema)
    return {**validate_json(compiled, data, strict=strict), "schema": "inline"}


def known_schema_names() -> List[str]:
    return list(SCHEMAS.keys())
