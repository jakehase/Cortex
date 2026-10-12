"""Level 34: The Validator - deterministic schema validation.

``validate_json`` checks JSON data against either the legacy flat format
(``{"required_fields": [...], "field_types": {...}}``) or a JSON-Schema
subset (type, required, properties, items, enum, const, minLength, maxLength,
minimum, maximum, exclusiveMinimum, exclusiveMaximum, minItems, maxItems,
pattern, additionalProperties). Booleans are never accepted as integers or
numbers. ``validate_schema_definition`` rejects malformed schemas up front so
validation itself never crashes on a registered schema.

Modes:
* strict (default): every violation is an error.
* lenient (``strict=False``): *type* and *additionalProperties* violations
  are reported as warnings instead of errors; missing required fields and all
  other constraint violations remain errors. The result always states the
  mode and whether the data would also pass strictly (``strict_valid``).
"""

from __future__ import annotations

import ast
import hashlib
import importlib.util
import json
import math
import re
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

MAX_SCHEMA_BYTES = 64_000
MAX_SCHEMA_DEPTH = 16
MAX_PATTERN_CHARS = 256
MAX_PATTERN_INPUT_CHARS = 10_000
MAX_ERRORS = 200

LEGACY_TYPE_LABELS = frozenset({"string", "boolean", "number", "integer", "object", "array", "any", "null"})
JSON_TYPES = frozenset({"string", "boolean", "number", "integer", "object", "array", "null"})
_JSON_SCHEMA_KEYS = frozenset(
    {
        "$schema", "$id", "title", "description", "type", "required", "properties", "items", "enum",
        "const", "minLength", "maxLength", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum",
        "minItems", "maxItems", "pattern", "additionalProperties", "default", "examples",
    }
)
# Downgraded to warnings in lenient mode; everything else stays an error.
LENIENT_RULES = frozenset({"type", "additionalProperties"})
# Rejects group-with-quantifier followed by another quantifier, e.g. (a+)+ .
_NESTED_QUANTIFIER_RE = re.compile(r"\([^()]*[+*][^()]*\)\s*[+*{]")


class SchemaDefinitionError(ValueError):
    """The schema definition itself is malformed."""


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _type_matches(value: Any, expected: str) -> bool:
    if expected == "any":
        return True
    if expected == "string":
        return isinstance(value, str)
    if expected == "boolean":
        return isinstance(value, bool)
    if expected == "integer":
        if isinstance(value, bool):
            return False
        if isinstance(value, int):
            return True
        return isinstance(value, float) and math.isfinite(value) and value.is_integer()
    if expected == "number":
        return _is_number(value) and (not isinstance(value, float) or math.isfinite(value))
    if expected == "object":
        return isinstance(value, dict)
    if expected == "array":
        return isinstance(value, list)
    if expected == "null":
        return value is None
    return False


def _json_type_name(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, int):
        return "integer"
    if isinstance(value, float):
        return "number"
    if isinstance(value, str):
        return "string"
    if isinstance(value, list):
        return "array"
    if isinstance(value, dict):
        return "object"
    return type(value).__name__


def is_legacy_schema(schema: Dict[str, Any]) -> bool:
    return isinstance(schema, dict) and ("required_fields" in schema or "field_types" in schema) and not (
        "type" in schema or "properties" in schema
    )


def legacy_to_json_schema(schema: Dict[str, Any]) -> Dict[str, Any]:
    properties: Dict[str, Any] = {}
    for field, label in (schema.get("field_types") or {}).items():
        properties[field] = {} if label == "any" else {"type": label}
    out: Dict[str, Any] = {"type": "object", "properties": properties}
    required = list(schema.get("required_fields") or [])
    if required:
        out["required"] = required
    return out


def _check_json_schema(node: Any, path: str, depth: int) -> None:
    if depth > MAX_SCHEMA_DEPTH:
        raise SchemaDefinitionError(f"{path}: schema nesting exceeds {MAX_SCHEMA_DEPTH}")
    if not isinstance(node, dict):
        raise SchemaDefinitionError(f"{path}: schema must be an object")
    unknown = sorted(set(node) - _JSON_SCHEMA_KEYS)
    if unknown:
        raise SchemaDefinitionError(f"{path}: unsupported keywords {unknown[:5]}")
    if "type" in node:
        types = node["type"] if isinstance(node["type"], list) else [node["type"]]
        if not types or any(not isinstance(t, str) or t not in JSON_TYPES for t in types):
            raise SchemaDefinitionError(f"{path}.type: must be one of {sorted(JSON_TYPES)} or a list of them")
    if "required" in node:
        req = node["required"]
        if not isinstance(req, list) or any(not isinstance(item, str) for item in req):
            raise SchemaDefinitionError(f"{path}.required: must be a list of strings")
    if "properties" in node:
        props = node["properties"]
        if not isinstance(props, dict):
            raise SchemaDefinitionError(f"{path}.properties: must be an object")
        for name, child in props.items():
            _check_json_schema(child, f"{path}.properties.{name}", depth + 1)
    if "items" in node:
        _check_json_schema(node["items"], f"{path}.items", depth + 1)
    if "additionalProperties" in node:
        extra = node["additionalProperties"]
        if isinstance(extra, dict):
            _check_json_schema(extra, f"{path}.additionalProperties", depth + 1)
        elif not isinstance(extra, bool):
            raise SchemaDefinitionError(f"{path}.additionalProperties: must be a boolean or schema")
    if "enum" in node and (not isinstance(node["enum"], list) or not node["enum"]):
        raise SchemaDefinitionError(f"{path}.enum: must be a non-empty list")
    for key in ("minLength", "maxLength", "minItems", "maxItems"):
        if key in node and (isinstance(node[key], bool) or not isinstance(node[key], int) or node[key] < 0):
            raise SchemaDefinitionError(f"{path}.{key}: must be a non-negative integer")
    for key in ("minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum"):
        if key in node and not _is_number(node[key]):
            raise SchemaDefinitionError(f"{path}.{key}: must be a number")
    if "pattern" in node:
        pattern = node["pattern"]
        if not isinstance(pattern, str) or len(pattern) > MAX_PATTERN_CHARS:
            raise SchemaDefinitionError(f"{path}.pattern: must be a string of at most {MAX_PATTERN_CHARS} chars")
        if _NESTED_QUANTIFIER_RE.search(pattern):
            raise SchemaDefinitionError(f"{path}.pattern: nested quantifiers are not allowed (ReDoS risk)")
        try:
            re.compile(pattern)
        except re.error as exc:
            raise SchemaDefinitionError(f"{path}.pattern: invalid regular expression ({exc})") from exc


def validate_schema_definition(definition: Any) -> Dict[str, Any]:
    """Return a normalised JSON-Schema-subset schema or raise SchemaDefinitionError."""

    if not isinstance(definition, dict):
        raise SchemaDefinitionError("schema definition must be an object")
    try:
        encoded = json.dumps(definition, allow_nan=False)
    except (TypeError, ValueError) as exc:
        raise SchemaDefinitionError("schema definition must be JSON-serialisable") from exc
    if len(encoded.encode("utf-8")) > MAX_SCHEMA_BYTES:
        raise SchemaDefinitionError(f"schema definition exceeds {MAX_SCHEMA_BYTES} bytes")
    if is_legacy_schema(definition):
        extra = sorted(set(definition) - {"required_fields", "field_types", "description", "title"})
        if extra:
            raise SchemaDefinitionError(f"unsupported legacy schema keys {extra[:5]}")
        required = definition.get("required_fields", [])
        if not isinstance(required, list) or any(not isinstance(item, str) for item in required):
            raise SchemaDefinitionError("required_fields must be a list of strings")
        field_types = definition.get("field_types", {})
        if not isinstance(field_types, dict):
            raise SchemaDefinitionError("field_types must be an object mapping field -> type label")
        for field, label in field_types.items():
            if not isinstance(label, str) or label not in LEGACY_TYPE_LABELS:
                raise SchemaDefinitionError(
                    f"field_types.{field}: unknown type label (allowed: {sorted(LEGACY_TYPE_LABELS)})"
                )
        return legacy_to_json_schema(definition)
    if not definition:
        raise SchemaDefinitionError("schema definition is empty")
    _check_json_schema(definition, "$", 0)
    return definition


def _validate_node(schema: Dict[str, Any], value: Any, path: str, out: List[Dict[str, str]]) -> None:
    if len(out) >= MAX_ERRORS:
        return

    def fail(rule: str, message: str) -> None:
        if len(out) < MAX_ERRORS:
            out.append({"path": path, "rule": rule, "message": message})

    if "type" in schema:
        types = schema["type"] if isinstance(schema["type"], list) else [schema["type"]]
        if not any(_type_matches(value, t) for t in types):
            fail("type", f"{path}: expected {'|'.join(types)}, got {_json_type_name(value)}")
            return
    if "enum" in schema and value not in schema["enum"]:
        fail("enum", f"{path}: value is not one of the allowed values")
    if "const" in schema and value != schema["const"]:
        fail("const", f"{path}: value does not equal the required constant")
    if isinstance(value, str):
        if "minLength" in schema and len(value) < schema["minLength"]:
            fail("minLength", f"{path}: shorter than {schema['minLength']}")
        if "maxLength" in schema and len(value) > schema["maxLength"]:
            fail("maxLength", f"{path}: longer than {schema['maxLength']}")
        if "pattern" in schema:
            if len(value) > MAX_PATTERN_INPUT_CHARS:
                fail("pattern", f"{path}: string too long to match pattern safely")
            elif re.search(schema["pattern"], value) is None:
                fail("pattern", f"{path}: does not match pattern")
    if _is_number(value):
        if "minimum" in schema and value < schema["minimum"]:
            fail("minimum", f"{path}: less than {schema['minimum']}")
        if "maximum" in schema and value > schema["maximum"]:
            fail("maximum", f"{path}: greater than {schema['maximum']}")
        if "exclusiveMinimum" in schema and value <= schema["exclusiveMinimum"]:
            fail("exclusiveMinimum", f"{path}: not greater than {schema['exclusiveMinimum']}")
        if "exclusiveMaximum" in schema and value >= schema["exclusiveMaximum"]:
            fail("exclusiveMaximum", f"{path}: not less than {schema['exclusiveMaximum']}")
    if isinstance(value, list):
        if "minItems" in schema and len(value) < schema["minItems"]:
            fail("minItems", f"{path}: fewer than {schema['minItems']} items")
        if "maxItems" in schema and len(value) > schema["maxItems"]:
            fail("maxItems", f"{path}: more than {schema['maxItems']} items")
        if isinstance(schema.get("items"), dict):
            for index, item in enumerate(value):
                _validate_node(schema["items"], item, f"{path}[{index}]", out)
    if isinstance(value, dict):
        for field in schema.get("required") or ():
            if field not in value:
                fail("required", f"Missing required field: {field}" if path == "$" else f"{path}: missing required field {field}")
        properties = schema.get("properties") or {}
        for field, child in properties.items():
            if field in value:
                _validate_node(child, value[field], f"{path}.{field}", out)
        extra = schema.get("additionalProperties", True)
        if extra is not True:
            for field in value:
                if field in properties:
                    continue
                if extra is False:
                    fail("additionalProperties", f"{path}: unexpected field {field}")
                elif isinstance(extra, dict):
                    _validate_node(extra, value[field], f"{path}.{field}", out)


def validate_json(schema: Dict[str, Any], data: Any, *, strict: bool = True) -> Dict[str, Any]:
    """Validate ``data``; ``schema`` must already be normalised/validated."""

    if is_legacy_schema(schema):
        schema = legacy_to_json_schema(schema)
    violations: List[Dict[str, str]] = []
    _validate_node(schema, data, "$", violations)
    if strict:
        errors, warnings = violations, []
    else:
        errors = [v for v in violations if v["rule"] not in LENIENT_RULES]
        warnings = [v for v in violations if v["rule"] in LENIENT_RULES]
    return {
        "valid": not errors,
        "mode": "strict" if strict else "lenient",
        "strict_valid": not violations,
        "errors": errors,
        "warnings": warnings,
        "truncated": len(violations) >= MAX_ERRORS,
    }


def schema_sha256(schema: Dict[str, Any]) -> str:
    return hashlib.sha256(json.dumps(schema, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()


def self_test() -> Dict[str, Any]:
    """Known-good and known-bad payloads; used by /validator/status."""

    schema = validate_schema_definition({"required_fields": ["n"], "field_types": {"n": "integer"}})
    good = validate_json(schema, {"n": 3})
    bad_bool = validate_json(schema, {"n": True})
    missing = validate_json(schema, {})
    passed = good["valid"] and not bad_bool["valid"] and not missing["valid"]
    return {"passed": bool(passed), "cases": 3}


class Validator:
    """Level 34 change-validation helper (honest about what it checks)."""

    def __init__(self):
        self.level = 34
        self.name = "Validator"

    def status(self):
        test = self_test()
        return {'level': self.level, 'name': self.name, 'status': 'active' if test['passed'] else 'degraded'}

    def validate_change(self, change_type: str, change_data: dict, origin_level: int = 0) -> dict:
        """Validate a proposed change: syntax and dependency presence only.

        Behavioural simulation is not implemented, so ``can_deploy`` is never
        true on the strength of this check alone.
        """
        tests = []
        if change_type == 'code':
            try:
                ast.parse(change_data.get('code', ''))
                tests.append({'name': 'syntax_check', 'passed': True})
            except SyntaxError as e:
                tests.append({'name': 'syntax_check', 'passed': False, 'error': str(e)})
                return {'valid': False, 'tests': tests, 'reason': 'Syntax error', 'can_deploy': False}

        deps = change_data.get('dependencies', [])
        missing = [d for d in deps if not self._check_dependency(d)]
        if missing:
            tests.append({'name': 'dependency_check', 'passed': False, 'missing': missing})
            return {'valid': False, 'tests': tests, 'reason': f'Missing dependencies: {missing}', 'can_deploy': False}
        tests.append({'name': 'dependency_check', 'passed': True})
        tests.append({'name': 'simulation', 'passed': None, 'status': 'not_implemented'})

        checked = [t for t in tests if t.get('passed') is not None]
        all_passed = all(t['passed'] for t in checked)
        return {
            'valid': all_passed,
            'validated_at': datetime.now().isoformat(),
            'change_type': change_type,
            'origin_level': origin_level,
            'tests': tests,
            'can_deploy': False,
            'can_deploy_reason': 'behavioural simulation is not implemented; requires review',
            'change_sha256': hashlib.sha256(
                json.dumps(change_data, sort_keys=True, default=str).encode('utf-8')
            ).hexdigest(),
        }

    def _check_dependency(self, dep: str) -> bool:
        """Presence check without importing (no module side effects)."""
        if not isinstance(dep, str) or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,63}", dep):
            return False
        try:
            return importlib.util.find_spec(f'cortex_server.modules.{dep}') is not None
        except (ImportError, ValueError):
            return False

    def rollback(self, rollback_hash: str) -> dict:
        raise NotImplementedError("Validator has no rollback capability")


_validator: Optional[Validator] = None


def get_validator() -> Validator:
    global _validator
    if _validator is None:
        _validator = Validator()
    return _validator


def _legacy_error_messages(rows: List[Dict[str, str]]) -> List[str]:
    return [row["message"] for row in rows]


def split_messages(result: Dict[str, Any]) -> Tuple[List[str], List[str]]:
    return _legacy_error_messages(result["errors"]), _legacy_error_messages(result["warnings"])
