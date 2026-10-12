"""L19 Geneticist repair: model candidates via level_model, deterministic fitness
and selection, owner-scoped proposals, gated apply, persona never overwritten."""

import asyncio
import json
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from cortex_server.modules import geneticist as legacy
from cortex_server.modules import geneticist_fitness, level_model
from cortex_server.modules.execution_engine import ExecutionBlocked
from cortex_server.modules.level_adapters import geneticist as geneticist_adapter
from cortex_server.routers import geneticist

ORIGINAL = "def f(l):\n  r=[]\n  for i in range(len(l)):\n    r.append(l[i]*2)\n  return r\n"
GOOD = "def f(l):\n    return [x * 2 for x in l]\n"
BROKEN = "def f(l):\n    return [x * 2 for x in l\n"


def _run(coro):
    return asyncio.run(coro)


def _ok(code, mutation_type="simplify"):
    return {"status": "ok", "ok": True, "level": 19, "name": "geneticist", "elapsed_ms": 5, "origin": "model",
            "data": {"code": code, "mutation_type": mutation_type, "description": "use a comprehension"},
            "model": "gpt-5.6-sol", "receipt_id": "rcpt-gen", "provider_invoked": True, "attempts": 1}


def _unavailable():
    return {"status": "model_unavailable", "ok": False, "level": 19, "name": "geneticist", "elapsed_ms": 2,
            "origin": "model_unavailable", "label": level_model.LEVEL_MODEL_UNAVAILABLE_LABEL, "error": "down"}


@pytest.fixture(autouse=True)
def _isolate(monkeypatch):
    monkeypatch.setattr(geneticist, "_PROPOSALS", {})
    monkeypatch.setattr(geneticist, "_oracle_cooldown_until", 0.0)
    monkeypatch.setattr(geneticist, "_oracle_consecutive_failures", 0)
    for name in ("CORTEX_EXECUTION_ALLOWED_ACTIONS", "CORTEX_EXECUTION_ALLOWED_ROOTS", "CORTEX_EXECUTION_CAPABILITY_TOKEN"):
        monkeypatch.delenv(name, raising=False)

    class _NoHTTP:
        def __init__(self, *_a, **_k):
            raise AssertionError("geneticist must not make HTTP self-calls for model work")

    monkeypatch.setattr(geneticist.httpx, "AsyncClient", _NoHTTP)


def _model(monkeypatch, results):
    seq = iter(results)
    calls = []

    async def fake(**kwargs):
        calls.append(kwargs)
        return next(seq)

    monkeypatch.setattr(level_model, "level_model_json", fake)
    return calls


def _principal(user):
    principal = SimpleNamespace(role="principal", credential_id="cred", tenant_id="t", workspace_id="w",
                                user_id=user, agent_id="a")
    return SimpleNamespace(state=SimpleNamespace(cortex_principal=principal), headers={})


def test_propose_selects_measured_compiling_candidate(monkeypatch):
    calls = _model(monkeypatch, [_ok(GOOD), _ok(BROKEN)])
    out = _run(geneticist.propose_change(geneticist.ProposeRequest(
        code=ORIGINAL, candidates=2, tests="assert f([1, 2]) == [2, 4]"), _principal("alice")))
    assert out["success"] is True and out["selected_id"] == "c1"
    by_id = {c["id"]: c for c in out["candidates"]}
    assert by_id["c1"]["fitness"]["compiles"] is True
    assert by_id["c2"]["fitness"]["compiles"] is False and by_id["c2"]["fitness"]["viable"] is False
    assert by_id["c1"]["fitness"]["score"] >= by_id["c2"]["fitness"]["score"]
    assert out["tests_mode"] == "static" and by_id["c1"]["fitness"]["tests"]["status"] == "not_run"
    assert out["mutated_code"] == GOOD and out["proposal_id"]
    assert len(calls) == 2 and all(c["schema"] is geneticist.CandidateOut for c in calls)


def test_no_viable_candidate_is_not_success(monkeypatch):
    _model(monkeypatch, [_ok(BROKEN), _ok(ORIGINAL)])
    out = _run(geneticist.propose_change(geneticist.ProposeRequest(code=ORIGINAL, candidates=2), None))
    assert out["success"] is False and out["error"] == "no_viable_candidate" and out["selected_id"] is None


def test_model_unavailable_returns_honest_failure(monkeypatch):
    _model(monkeypatch, [_unavailable(), _unavailable()])
    out = _run(geneticist.propose_change(geneticist.ProposeRequest(code=ORIGINAL, candidates=2), None))
    assert out["success"] is False and out["origin"] == "model_unavailable"
    assert "mutated_code" not in out and "candidates" not in out


def test_fitness_rejects_new_risky_behaviour():
    risky = "import subprocess\ndef f(l):\n    subprocess.run(['ls'])\n    return [x*2 for x in l]\n"
    fitness = geneticist_fitness.evaluate(ORIGINAL, risky)
    assert fitness["viable"] is False and "introduces_high_severity_risk" in fitness["not_viable_reasons"]
    undefined = geneticist_fitness.evaluate(ORIGINAL, "def f(l):\n    return [helper(x) for x in l]\n")
    assert "undefined_names" in undefined["not_viable_reasons"]


def test_proposals_are_owner_scoped(monkeypatch):
    _model(monkeypatch, [_ok(GOOD)])
    out = _run(geneticist.propose_change(geneticist.ProposeRequest(code=ORIGINAL, candidates=1), _principal("alice")))
    pid = out["proposal_id"]
    assert _run(geneticist.get_proposal(pid, _principal("alice")))["new_code"] == GOOD
    with pytest.raises(HTTPException) as other:
        _run(geneticist.get_proposal(pid, _principal("mallory")))
    assert other.value.status_code == 404


def test_target_path_requires_execution_grant():
    with pytest.raises(HTTPException) as denied:
        _run(geneticist.propose_change(geneticist.ProposeRequest(target_path="/etc/passwd"), Request(
            {"type": "http", "method": "POST", "path": "/geneticist/propose", "headers": [], "query_string": b""})))
    assert denied.value.status_code in {403, 503}


def test_apply_requires_council_model_review_before_write(monkeypatch, tmp_path):
    root = tmp_path / "ws"
    root.mkdir()
    target = root / "module.py"
    target.write_text("VALUE = 1\n")
    monkeypatch.setenv("CORTEX_EXECUTION_ALLOWED_ACTIONS", "geneticist.apply")
    monkeypatch.setenv("CORTEX_EXECUTION_ALLOWED_ROOTS", str(root))
    monkeypatch.setenv("CORTEX_EXECUTION_CAPABILITY_TOKEN", "tok")
    geneticist._PROPOSALS["p1"] = {"strategy": "mutate", "target_path": str(target), "new_code": "VALUE = 2\n",
                                   "diff": "-VALUE = 1\n+VALUE = 2\n", "fitness": {}}

    async def healthy_gate():
        rows = [{"ok": True, "status_code": 200}] * 3
        return {"success": True, "scan": {"results": rows, "issues_found": 0, "watchers_checked": 3}}

    monkeypatch.setattr(geneticist, "_sentinel_apply_gate", healthy_gate)
    _model(monkeypatch, [{"status": "timeout", "ok": False, "elapsed_ms": 1}])
    request = Request({"type": "http", "method": "POST", "path": "/geneticist/apply", "query_string": b"",
                       "headers": [(b"x-cortex-execution-capability", b"tok")]})
    out = _run(geneticist.apply_proposal(geneticist.ApplyRequest(proposal_id="p1", confirm=True), request, None))
    assert out["blocked"] is True and out["error"] == "council_review_unavailable"
    assert target.read_text() == "VALUE = 1\n"

    _model(monkeypatch, [{"status": "ok", "ok": True, "data": {
        "verdict": "APPROVE", "risk_score": 0.1, "top_concerns": [], "required_conditions": [],
        "rationale": "fine", "suggested_changes": []}, "model": "m", "receipt_id": "r"}])
    with pytest.raises(HTTPException) as no_capability:
        _run(geneticist.apply_proposal(geneticist.ApplyRequest(proposal_id="p1", confirm=True), request, None))
    assert no_capability.value.status_code == 403  # no consumed action capability -> no write
    assert target.read_text() == "VALUE = 1\n"


def test_legacy_persona_module_never_writes(tmp_path):
    persona = tmp_path / "persona.txt"
    g = legacy.TheGeneticist(persona_path=str(persona))
    assert not persona.exists()  # construction no longer creates it
    persona.write_text("You are Gladys.")
    assert g._apply_mutation_file("You are Evil.", "x") is False
    assert g.apply_mutation("You are Evil.", "x") is False
    result = g.test_and_apply_mutation("You are Evil.", "x")
    assert result["success"] is False and result["error"] == legacy.PERSONA_WRITE_FORBIDDEN
    assert persona.read_text() == "You are Gladys."
    assert not (tmp_path / "persona.txt.backup").exists()


def test_adapter_contract(monkeypatch):
    with pytest.raises(ExecutionBlocked) as no_code:
        _run(geneticist_adapter.run("make my code faster", {"principal_scope_key": "p:1"}))
    assert no_code.value.reason == "no_python_code_block_in_message"

    _model(monkeypatch, [_ok(GOOD), _ok(BROKEN)])
    out = _run(geneticist_adapter.run(f"simplify this\n```python\n{ORIGINAL}```", {"principal_scope_key": "p:1"}))
    assert out["operation"] == "geneticist.propose" and out["origin"] == "model"
    assert out["data"]["applied"] is False and out["data"]["selected"]["fitness"]["compiles"] is True
    assert "nothing was written" in out["summary"]
    json.dumps(out)

    _model(monkeypatch, [_unavailable(), _unavailable()])
    with pytest.raises(ExecutionBlocked) as down:
        _run(geneticist_adapter.run(f"simplify\n```python\n{ORIGINAL}```", {"principal_scope_key": "p:1"}))
    assert down.value.reason.startswith("model_unavailable")
