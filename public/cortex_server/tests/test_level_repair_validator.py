"""L34 Validator repair: bool!=int, no 500s on custom schemas, honest strict/lenient, status."""

import asyncio

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from cortex_server.modules import validator as validator_module
from cortex_server.modules.execution_engine import ExecutionBlocked
from cortex_server.modules.level_adapters import validator as validator_adapter
from cortex_server.routers import validator


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(validator, "SCHEMAS", dict(validator.SCHEMAS))
    monkeypatch.setattr(validator, "_COMPILED", dict(validator._COMPILED))
    monkeypatch.setattr(validator, "validator_state", {key: 0 for key in validator.validator_state})
    app = FastAPI()
    app.include_router(validator.router, prefix="/validator")
    return TestClient(app)


def _validate(client, body):
    return client.post("/validator/validate", json=body)


def test_valid_and_invalid_builtin_payloads(client):
    ok = _validate(client, {"schema": "api_response", "data": {"success": True, "data": {}}}).json()
    assert ok["valid"] is True and ok["mode"] == "strict" and ok["errors"] == []
    bad = _validate(client, {"schema": "api_response", "data": {"success": "yes"}}).json()
    assert bad["valid"] is False
    assert "Missing required field: data" in bad["errors"]
    assert any(row["rule"] == "type" and row["path"] == "$.success" for row in bad["error_details"])


def test_boolean_is_never_an_integer_or_number(client):
    created = client.post(
        "/validator/schema",
        json={"name": "custom_n", "definition": {"required_fields": ["n"], "field_types": {"n": "integer"}}},
    )
    assert created.json()["created"] is True
    assert _validate(client, {"schema": "custom_n", "data": {"n": True}}).json()["valid"] is False
    assert _validate(client, {"schema": "custom_n", "data": {"n": 3}}).json()["valid"] is True
    number_schema = {"type": "object", "properties": {"x": {"type": "number"}}}
    result = _validate(client, {"schema_definition": number_schema, "data": {"x": False}}).json()
    assert result["valid"] is False


def test_malformed_custom_schema_is_rejected_at_registration_and_never_500s(client):
    bad = client.post("/validator/schema", json={"name": "custom_bad", "definition": {"field_types": []}})
    assert bad.status_code == 422
    also_bad = client.post("/validator/schema", json={"name": "custom_bad2", "definition": {"required_fields": "abc"}})
    assert also_bad.status_code == 422
    unknown = _validate(client, {"schema": "custom_bad", "data": {}})
    assert unknown.status_code == 200
    assert unknown.json()["valid"] is False
    assert unknown.json()["errors"] == ["Unknown schema: custom_bad"]


def test_lenient_mode_is_labelled_and_reports_strict_outcome(client):
    body = _validate(client, {"schema": "api_response", "data": {"success": "yes", "data": 1}, "strict": False}).json()
    assert body["mode"] == "lenient"
    assert body["valid"] is True
    assert body["strict_valid"] is False
    assert body["warnings"]
    # Missing required fields are errors even in lenient mode.
    missing = _validate(client, {"schema": "api_response", "data": {"success": True}, "strict": False}).json()
    assert missing["valid"] is False


def test_strict_must_be_a_real_boolean(client):
    response = _validate(client, {"schema": "api_response", "data": {}, "strict": "false"})
    assert response.status_code == 422


def test_nested_json_schema_and_redos_guard(client):
    schema = {
        "type": "object",
        "required": ["items"],
        "properties": {"items": {"type": "array", "items": {"type": "integer", "minimum": 0}}},
        "additionalProperties": False,
    }
    body = _validate(client, {"schema_definition": schema, "data": {"items": [1, -1], "extra": 1}}).json()
    rules = {row["rule"] for row in body["error_details"]}
    assert rules == {"minimum", "additionalProperties"}
    redos = client.post("/validator/schema", json={"name": "custom_re", "definition": {"type": "string", "pattern": "(a+)+$"}})
    assert redos.status_code == 422


def test_reserved_and_unknown_names(client):
    assert client.post("/validator/schema", json={"name": "api_response", "definition": {}}).json()["error"] == "reserved_schema_name"
    assert _validate(client, {"schema": "nope", "data": {}}).json()["valid"] is False
    assert _validate(client, {"data": {}}).status_code == 422


def test_status_is_measured_by_self_test_and_drops_false_strict_claim(client):
    _validate(client, {"schema": "api_response", "data": {"success": "x", "data": 1}, "strict": False})
    body = client.get("/validator/status").json()
    data = body["data"]
    assert "strict_mode_enforced" not in data
    assert data["self_test"]["passed"] is True and data["status"] == "active"
    assert data["lenient_validations"] == 1
    assert data["lenient_passes_with_warnings"] == 1


def test_validate_change_never_claims_deployable_or_rollback():
    result = validator_module.Validator().validate_change("code", {"code": "x = 1", "dependencies": ["kernel"]})
    assert result["valid"] is True
    assert result["can_deploy"] is False
    with pytest.raises(NotImplementedError):
        validator_module.Validator().rollback("abc")
    assert validator_module.Validator()._check_dependency("../../etc") is False


def test_validator_adapter_contract():
    out = asyncio.run(validator_adapter.run("check", {
        "validation_target": {"schema": "api_response", "data": {"success": 1}},
    }))
    assert out["operation"] == "validator.validate"
    assert out["data"]["valid"] is False and out["data"]["error_count"] >= 1
    syntax = asyncio.run(validator_adapter.run('is this valid json {"a": 1,}', {}))
    assert syntax["data"]["well_formed"] is False
    good = asyncio.run(validator_adapter.run('validate {"a": [1, 2]}', {}))
    assert good["data"]["well_formed"] is True and good["data"]["top_level_keys"] == ["a"]
    with pytest.raises(ExecutionBlocked) as blocked:
        asyncio.run(validator_adapter.run("hello there", {}))
    assert blocked.value.reason == "no_validation_target"
