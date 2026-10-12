"""L27 Forge repair: honest 501 scaffolds, syntax-validated output, truthful
status, model-backed review with static fallback, legacy writes removed."""

import ast
import asyncio
import json
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from cortex_server.modules import forge as legacy_forge
from cortex_server.modules import level_model
from cortex_server.modules.execution_engine import ExecutionBlocked
from cortex_server.modules.level_adapters import forge as forge_adapter
from cortex_server.routers import forge


def _run(coro):
    return asyncio.run(coro)


def _review_ok():
    return {"status": "ok", "ok": True, "level": 27, "name": "forge", "elapsed_ms": 6, "origin": "model",
            "model": "gpt-5.6-sol", "receipt_id": "rcpt-forge", "provider_invoked": True, "attempts": 1,
            "data": {"summary": "Scaffold only; /run is a 501 stub.", "verdict": "revise",
                     "risks": [{"risk": "no input validation", "severity": "medium"}],
                     "missing_tests": ["POST /run happy path"], "implementation_gaps": ["POST /run"],
                     "suggested_changes": []}}


def _model(monkeypatch, result):
    calls = []

    async def fake(**kwargs):
        calls.append(kwargs)
        return result

    monkeypatch.setattr(level_model, "level_model_json", fake)
    return calls


@pytest.mark.parametrize("template", sorted(forge.TEMPLATES))
def test_generated_scaffolds_never_fake_success(template):
    out = forge._validated_generate(forge.GenerateRequest(
        level_number=40, level_name="Probe Level", description="probe", endpoints=["POST /run", "GET /items/{item_id}"],
        template=template))
    tree = ast.parse(out.code)
    assert '"message": "Not yet implemented"' not in out.code
    assert "FORGE SCAFFOLD" in out.code and out.scaffold is True and out.syntax_ok is True
    statuses = [n for n in ast.walk(tree) if isinstance(n, ast.Constant) and n.value == "active"]
    assert statuses == []  # generated /status never claims to be active
    if template == "standard_router":
        assert set(out.not_implemented_endpoints) == {"POST /run", "GET /items/{item_id}"}
    if template == "data_processor":
        assert "POST /process" in out.not_implemented_endpoints


def test_description_cannot_break_out_of_docstrings():
    for desc in ['"""\nimport os\nos.system("id")\n"""', 'ends with a quote"', "trailing backslash\\"]:
        out = forge._validated_generate(forge.GenerateRequest(level_number=40, level_name="Doc", description=desc))
        tree = ast.parse(out.code)
        assert not any(isinstance(n, ast.Import) for n in tree.body)


def test_invalid_input_still_rejected():
    with pytest.raises(HTTPException):
        forge._validated_generate(forge.GenerateRequest(level_number=1, level_name='x"); import os #', description="d"))
    with pytest.raises(HTTPException):
        forge._validated_generate(forge.GenerateRequest(level_number=1, level_name="x", description="d",
                                                        endpoints=["GET /../../etc"]))


def test_status_does_not_advertise_commit_or_disk_write():
    request = SimpleNamespace(app=SimpleNamespace(routes=[
        SimpleNamespace(path=f"/forge{p}", methods={m}) for m, p in
        [("GET", "/status"), ("GET", "/health"), ("GET", "/templates"), ("POST", "/generate"), ("POST", "/review"),
         ("POST", "/propose"), ("POST", "/reject")]
    ]))
    status = _run(forge.forge_status(request))
    assert "commit_to_disk" not in status["capabilities"] and "approve" not in status["capabilities"]
    assert {"scaffold_generation", "template_listing", "model_code_review"} <= set(status["capabilities"])
    reasons = {row["capability"]: row["reason"] for row in status["unavailable"]}
    assert "propose" in reasons  # execution action not enabled in tests
    assert "allowlist_disk_write" not in json.dumps(status["capabilities"])


def test_review_happy_and_model_unavailable(monkeypatch):
    calls = _model(monkeypatch, _review_ok())
    gen = forge.GenerateRequest(level_number=40, level_name="Probe", description="d", endpoints=["POST /run"])
    out = _run(forge.forge_review(forge.ReviewRequest(generate=gen), SimpleNamespace(state=SimpleNamespace())))
    assert out["success"] is True and out["receipt_id"] == "rcpt-forge"
    assert out["review"]["verdict"] == "revise"
    assert out["static_checks"]["not_implemented_endpoints"] == ["POST /run"]
    assert calls[0]["schema"] is forge.ForgeReviewOut

    _model(monkeypatch, {"status": "timeout", "ok": False, "elapsed_ms": 1})
    out = _run(forge.forge_review(forge.ReviewRequest(code="def f(:\n"), None))
    assert out["success"] is False and out["review"] is None and out["fallback"] == "static_checks_only"
    assert out["static_checks"]["syntax_ok"] is False
    with pytest.raises(HTTPException):
        _run(forge.forge_review(forge.ReviewRequest(), None))


def test_static_checks_detect_fake_success_stubs():
    code = ('from fastapi import APIRouter\nrouter = APIRouter()\n@router.post("/x")\nasync def x():\n'
            '    return {"success": True, "message": "Not yet implemented"}\n')
    checks = forge.static_scaffold_checks(code)
    assert checks["fake_success_stubs_at_lines"] == [5] and checks["static_check_passed"] is False


def test_legacy_module_has_no_ungated_writes(monkeypatch, tmp_path):
    def no_mkdir(*_a, **_k):
        raise AssertionError("constructor must not create directories")

    monkeypatch.setattr(Path, "mkdir", no_mkdir)
    instance = legacy_forge.Forge()
    with pytest.raises(legacy_forge.ForgeWriteForbidden):
        instance.generate_module({"name": "x"})
    with pytest.raises(legacy_forge.ForgeWriteForbidden):
        instance.generate_from_gap({"capability": "storage", "pattern_match": "data_processor", "suggested_module": "s"})
    scan = instance.autonomous_scan(["nexus"], ["storage"])
    assert scan["auto_generated"] == [] and scan["gaps"][0]["method"] == "keyword_match"
    assert instance.propose_enhancement("nexus")["proposals"] == []


def test_adapter_contract(monkeypatch):
    _model(monkeypatch, _review_ok())
    out = _run(forge_adapter.run("generate a router called Billing Sync with POST /sync",
                                 {"principal_scope_key": "p:1"}))
    assert out["operation"] == "forge.scaffold" and out["data"]["written_to_disk"] is False
    assert out["data"]["scaffold"]["not_implemented_endpoints"] == ["POST /sync"]
    assert out["origin"] == "model" and out["receipt_id"] == "rcpt-forge"
    json.dumps(out)

    _model(monkeypatch, {"status": "model_unavailable", "ok": False, "elapsed_ms": 1})
    reviewed = _run(forge_adapter.run("review this\n```python\nx = eval(input())\n```", {"principal_scope_key": "p:1"}))
    assert reviewed["origin"] == "deterministic" and reviewed["data"]["review"] is None
    assert reviewed["data"]["static_checks"]["static_check_passed"] is False

    with pytest.raises(ExecutionBlocked):
        _run(forge_adapter.run("how are you?", {"principal_scope_key": "p:1"}))


def test_adapter_derives_name_from_purpose(monkeypatch):
    _model(monkeypatch, {"status": "model_unavailable", "ok": False, "elapsed_ms": 1})
    out = _run(forge_adapter.run("Scaffold a router for tracking prior authorizations.", {"principal_scope_key": "p:1"}))
    assert out["operation"] == "forge.scaffold"
    assert out["data"]["scaffold"]["filename"] == "prior_authorizations.py"
    assert out["data"]["scaffold"]["endpoints_inferred"] is True
    assert "POST /prior-authorizations" in out["data"]["scaffold"]["not_implemented_endpoints"]
    assert out["data"]["written_to_disk"] is False
    with pytest.raises(ExecutionBlocked):
        _run(forge_adapter.run("Scaffold something", {"principal_scope_key": "p:1"}))
