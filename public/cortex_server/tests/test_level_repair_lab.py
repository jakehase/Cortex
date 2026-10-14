"""L4 Lab repair: exact AST-whitelisted compute, AST risk analysis instead of hash
scores, model review only via level_model, execution still sandbox + approval."""

import asyncio
import json
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from cortex_server.modules import lab_analysis, lab_compute, level_model
from cortex_server.modules.execution_engine import ExecutionBlocked
from cortex_server.modules.level_adapters import lab as lab_adapter
from cortex_server.routers import lab


def _run(coro):
    return asyncio.run(coro)


def _request():
    return SimpleNamespace(state=SimpleNamespace(), headers={}, url=SimpleNamespace(path="/lab/transcend/execute"))


def _review_ok(verdict="no_blocking_risks"):
    return {"status": "ok", "ok": True, "level": 4, "name": "lab", "elapsed_ms": 5, "origin": "model",
            "model": "gpt-5.6-sol", "receipt_id": "rcpt-lab", "provider_invoked": True, "attempts": 1,
            "data": {"verdict": verdict, "summary": "Prints a constant.", "risks": [], "experiments": [],
                     "expected_behavior": "prints 1", "confidence": "high"}}


def _unavailable():
    return {"status": "model_unavailable", "ok": False, "level": 4, "name": "lab", "elapsed_ms": 5,
            "origin": "model_unavailable", "label": level_model.LEVEL_MODEL_UNAVAILABLE_LABEL, "error": "down"}


def _model(monkeypatch, result):
    calls = []

    async def fake(**kwargs):
        calls.append(kwargs)
        return result

    monkeypatch.setattr(level_model, "level_model_json", fake)
    return calls


@pytest.mark.parametrize(
    ("expression", "exact_repr"),
    [("2**100", "1267650600228229401496703205376"), ("1/3 + 1/6", "1/2"), ("0.1 + 0.2", "3/10"),
     ("2^10", "1024"), ("factorial(20)", "2432902008176640000"), ("-3 % 5", "2")],
)
def test_compute_is_exact(expression, exact_repr):
    result = lab_compute.evaluate(expression)
    assert result["exact_repr"] == exact_repr
    assert result["method"] == "ast_whitelist"


@pytest.mark.parametrize("expression", ["__import__('os')", "(1).__class__", "open('x')", "[x for x in (1,)]",
                                        "lambda: 1", "9**9**9", "10**100000", "", "1 +"])
def test_compute_rejects_non_arithmetic_and_unbounded(expression):
    with pytest.raises(lab_compute.LabComputeError):
        lab_compute.evaluate(expression)


def test_compute_endpoint_shapes_and_errors():
    ok = _run(lab.lab_compute_endpoint(lab.LabComputeRequest(expression="mean([1, 2, 3, 4])")))
    assert ok["success"] is True and ok["value"] == 2.5 and ok["origin"] == "deterministic"
    with pytest.raises(HTTPException) as bad:
        _run(lab.lab_compute_endpoint(lab.LabComputeRequest(expression="__import__('os')")))
    assert bad.value.status_code == 422


def test_static_analysis_flags_real_risks_and_is_semantics_stable():
    assert lab_analysis.static_analysis("print(1)")["static_check_passed"] is True
    assert lab_analysis.static_analysis("print(1)") == lab_analysis.static_analysis("print(1)  # comment\n\n")
    destructive = lab_analysis.static_analysis('import os; os.system("rm -rf /")')
    assert destructive["static_check_passed"] is False
    assert destructive["findings"][0]["rule"] == "subprocess" and destructive["findings"][0]["line"] == 1
    obfuscated = lab_analysis.static_analysis('__import__("so"+"cket").create_connection(("1.2.3.4",80))')
    assert obfuscated["static_check_passed"] is False
    assert any(f["rule"] == "dynamic_import" for f in obfuscated["findings"])
    escape = lab_analysis.static_analysis("().__class__.__bases__[0].__subclasses__()")
    assert any(f["rule"] == "sandbox_escape_pattern" for f in escape["findings"])


def test_transcend_plan_has_no_hash_scores_and_no_model_by_default(monkeypatch):
    calls = _model(monkeypatch, _review_ok())
    bundle = _run(lab.lab_transcend_plan(lab.LabTranscendRequest(code="print(1)"), _request()))
    encoded = json.dumps(bundle)
    for removed in ("predicted_failure_probability", "escrow_state", "verifier_votes", "proved"):
        assert removed not in encoded
    assert bundle["static_analysis"]["method"] == "ast_static_heuristic"
    assert bundle["model_review"] == {"requested": False}
    assert calls == []


def test_transcend_plan_model_review_happy_and_unavailable(monkeypatch):
    calls = _model(monkeypatch, _review_ok())
    bundle = _run(lab.lab_transcend_plan(lab.LabTranscendRequest(code="print(1)", model_review=True), _request()))
    assert bundle["model_review"]["ok"] is True
    assert bundle["model_review"]["receipt_id"] == "rcpt-lab"
    assert calls[0]["principal_scope_key"] != "internal-system"

    _model(monkeypatch, _unavailable())
    bundle = _run(lab.lab_transcend_plan(lab.LabTranscendRequest(code="print(1)", model_review=True), _request()))
    assert bundle["model_review"]["ok"] is False
    assert bundle["model_review"]["origin"] == "model_unavailable"
    assert "review" not in bundle["model_review"]


def test_transcend_execute_gates_before_the_sandbox(monkeypatch):
    async def must_not_run(*_args, **_kwargs):
        raise AssertionError("sandbox must not be reached")

    monkeypatch.setattr(lab, "_run_python", must_not_run)
    monkeypatch.setattr(lab, "extract_trace_context", lambda *a, **k: {})
    blocked = _run(lab.lab_transcend_execute(
        lab.LabTranscendExecuteRequest(code='import os; os.system("rm -rf /")'), _request(), object()))
    assert blocked["blocked"] is True and blocked["gate"] == "static_analysis"

    _model(monkeypatch, _unavailable())
    blocked = _run(lab.lab_transcend_execute(
        lab.LabTranscendExecuteRequest(code="print(1)", require_verifier_release=True), _request(), object()))
    assert blocked["gate"] == "model_review" and blocked["reason"] == "model_unavailable"

    ran = []

    async def sandbox(code, **kwargs):
        ran.append(code)
        return {"success": True, "stdout": "1\n", "exit_code": 0}

    monkeypatch.setattr(lab, "_run_python", sandbox)
    done = _run(lab.lab_transcend_execute(lab.LabTranscendExecuteRequest(code="print(1)"), _request(), object()))
    assert done["blocked"] is False and ran == ["print(1)"]


def test_status_does_not_advertise_hash_capabilities():
    status = _run(lab.lab_status())
    encoded = json.dumps(status)
    assert "verifier_escrow" not in encoded and "self_modeling_twin" not in encoded
    assert status["execution"]["available"] is False or status["execution"]["reason"] is None


def test_status_is_restricted_when_sandbox_paths_are_inaccessible(monkeypatch):
    monkeypatch.setattr(lab, "LAB_WORKER_CONFIG", Path("/root/inaccessible/worker.json"))
    monkeypatch.setattr(lab.Path, "is_file", lambda self: (_ for _ in ()).throw(PermissionError()))
    monkeypatch.setattr(
        lab,
        "execution_capability_status",
        lambda **kwargs: {
            "enabled": False,
            "allowedActions": [],
            "executableActions": [],
            "allowedRoots": [],
            "capabilityTokenConfigured": False,
            "defaultDeny": True,
            "actionScope": {"requiredActions": [lab.LAB_EXECUTION_ACTION], "requirementsMet": False},
        },
    )

    status = _run(lab.lab_status())

    assert status["status"] == "restricted_by_design"
    assert status["execution"]["available"] is False
    assert status["execution"]["reason"] == "execution_capability_not_configured"


def test_adapter_contract():
    out = _run(lab_adapter.run("what is 2**100 and 15% of 240?", {}))
    assert out["operation"] == "lab.compute" and out["origin"] == "deterministic"
    assert "1267650600228229401496703205376" in out["summary"]
    assert any(r["expression"].strip("()") == "15/100*240" and r["exact_repr"] == "36" for r in out["data"]["results"])
    assert out["data"]["execution"]["performed"] is False
    json.dumps(out)

    code = _run(lab_adapter.run("please run this\n```python\nimport subprocess\nsubprocess.run(['ls'])\n```", {}))
    assert code["data"]["static_analysis"][0]["static_check_passed"] is False
    assert code["data"]["execution"]["requires_approval"] is True

    with pytest.raises(ExecutionBlocked):
        _run(lab_adapter.run("my phone is 555-1234", {}))


def test_adapter_handles_spoken_arithmetic_and_stats():
    out = _run(lab_adapter.run(
        "What is 17.5% of 2340, plus 112? Also the mean of 4, 8, 15, 16, 23, 42.", {}))
    decimals = {r["expression"]: r["decimal"] for r in out["data"]["results"]}
    assert decimals == {"(17.5/100*2340) + 112": "521.5", "mean(4, 8, 15, 16, 23, 42)": "18"}
    assert "= 521.5 (exact)" in out["summary"] and "819/2" not in out["summary"]


@pytest.mark.parametrize("text,expected", [
    ("What is 12 times 7 minus 4?", ["12 * 7 - 4"]),
    ("What's the median of 3, 9 and 1", ["median(3, 9, 1)"]),
    ("Call me at 555-123-4567", []),
    ("On 2026-10-04 we billed 3 claims", []),
    ("The visit lasted 45 minutes, plus travel", []),
    ("I have 3 kids, 2 cats", []),
])
def test_extract_expressions_natural_language(text, expected):
    assert lab_compute.extract_expressions(text) == expected


def test_repeating_fraction_shows_both_forms():
    out = _run(lab_adapter.run("what is 1/3 + 1/2?", {}))
    assert "= 5/6 ≈ 0.8333" in out["summary"]
