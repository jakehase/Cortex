from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional, List, Dict, Any

router = APIRouter(tags=["Validator"])

validator_state = {
    "validations": 0,
    "failures": 0,
    "unknown_schema_failures": 0,
    "type_mismatch_failures": 0,
}

# Predefined schemas
SCHEMAS = {
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
    data: Dict[str, Any]
    schema: str
    strict: bool = True

class SchemaRequest(BaseModel):
    name: str
    definition: Dict[str, Any]

class ValidatorResponse(BaseModel):
    success: bool
    data: dict
    error: Optional[str] = None

@router.post("/validate")
async def validate_data(request: ValidateRequest):
    validator_state["validations"] += 1
    errors = []
    warnings = []

    if request.schema not in SCHEMAS:
        validator_state["failures"] += 1
        validator_state["unknown_schema_failures"] += 1
        return {"valid": False, "errors": [f"Unknown schema: {request.schema}"], "warnings": []}

    schema_def = SCHEMAS[request.schema]

    # Check required fields
    for field in schema_def.get("required_fields", []):
        if field not in request.data:
            errors.append(f"Missing required field: {field}")

    # Check field types
    for field, expected_type in schema_def.get("field_types", {}).items():
        if field not in request.data:
            continue

        expected = TYPE_MAP.get(expected_type)
        if not expected:
            # Unknown schema type label; warn but do not fail validation pipeline
            warnings.append(f"Unknown expected type '{expected_type}' for field {field}")
            continue

        if expected_type == "any":
            continue

        actual_value = request.data[field]
        if not isinstance(actual_value, expected):
            msg = f"Field {field}: expected {expected_type}, got {type(actual_value).__name__}"
            if request.strict:
                errors.append(msg)
                validator_state["type_mismatch_failures"] += 1
            else:
                warnings.append(msg)

    if errors:
        validator_state["failures"] += 1

    return {
        "valid": len(errors) == 0,
        "errors": errors,
        "warnings": warnings
    }

@router.post("/schema")
async def create_schema(request: SchemaRequest):
    reserved = {"user_request", "api_response", "event_log"}
    if request.name in reserved:
        return {"created": False, "error": "reserved_schema_name"}
    if not request.name.startswith("custom_"):
        return {"created": False, "error": "schema_name_must_start_with_custom_"}

    SCHEMAS[request.name] = request.definition
    return {"created": True, "name": request.name, "fields": len(request.definition.get("required_fields", []))}

@router.get("/schemas")
async def list_schemas():
    return ValidatorResponse(
        success=True,
        data={"schemas": list(SCHEMAS.keys()), "count": len(SCHEMAS)},
        error=None
    )

@router.get("/status")
async def validator_status():
    return ValidatorResponse(
        success=True,
        data={
            "level": 34, "name": "The Validator", "status": "active",
            "strict_mode_enforced": True,
            "validations": validator_state["validations"],
            "failures": validator_state["failures"],
            "unknown_schema_failures": validator_state["unknown_schema_failures"],
            "type_mismatch_failures": validator_state["type_mismatch_failures"],
            "success_rate": round(1 - (validator_state["failures"] / max(1, validator_state["validations"])), 2),
            "available_schemas": list(SCHEMAS.keys())
        },
        error=None
    )
