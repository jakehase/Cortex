"""L35 Singularity repair: model-backed review, labelled static checks, restricted file reads."""

import asyncio
import json
from contextlib import asynccontextmanager
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from cortex_server.modules import level_model
from cortex_server.modules import singularity as review_core
from cortex_server.modules.execution_engine import ExecutionBlocked
from cortex_server.modules.level_adapters import singularity as review_adapter
from cortex_server.routers import singularity as singularity_router


def _run(coro):
    return asyncio.run(coro)


def _request(admin=False):
    principal = SimpleNamespace(role="admin", credential_id="cortex-admin") if admin else None
    return SimpleNamespace(state=SimpleNamespace(cortex_principal=principal), headers={})


def _ok(data):
    return {"status": "ok", "ok": True, "level": 35, "name": "singularity", "elapsed_ms": 5,
            "origin": "model", "data": data, "model": "gpt-5.6-sol", "receipt_id": "rcpt-l35",
            "provider_invoked": True, "attempts": 1}


def _unavailable(status="model_unavailable"):
    return {"status": status, "ok": False, "level": 35, "name": "singularity", "elapsed_ms": 5,
            "origin": "model_unavailable", "label": level_model.LEVEL_MODEL_UNAVAILABLE_LABEL,
            "error": "provider down"}


CODE = "def avg(xs):\n    return sum(xs)/len(xs)\n"
REVIEW = {
    "summary": "avg() divides by zero on an empty list.",
    "findings": [
        {"category": "bug", "severity": "high", "quote": "return sum(xs)/len(xs)",
         "description": "ZeroDivisionError when xs is empty.", "suggestion": "Return None or raise ValueError for empty input."},
        {"category": "security", "severity": "critical", "quote": "os.system(cmd)",
         "description": "Hallucinated: not in the code.", "suggestion": "n/a"},
    ],
}


@asynccontextmanager
async def _conscious_stub(*_args, **_kwargs):
    yield SimpleNamespace(set_result=lambda _r: None)


@pytest.fixture(autouse=True)
def _isolate(monkeypatch):
    monkeypatch.setattr(singularity_router, "conscious_action", _conscious_stub)
    monkeypatch.setattr(singularity_router, "_broadcast_self_improvement", lambda *_a, **_k: None)
    monkeypatch.setattr(review_core, "_stats", {
        "since": "test", "model_successes": 0, "model_failures": 0, "consecutive_failures": 0,
        "last_model_status": None, "last_model_at": None, "last_model_success_at": None,
        "findings_dropped_unverified": 0,
    })
    for key in ("analyses_run", "analyses_model", "analyses_static_only", "improvements_suggested",
                "improvement_proposals"):
        monkeypatch.setitem(singularity_router.singularity_state, key, 0)


def _install(monkeypatch, results):
    calls = []
    seq = iter(results)

    async def fake(**kwargs):
        calls.append(kwargs)
        return next(seq)

    monkeypatch.setattr(level_model, "level_model_json", fake)
    return calls


def test_analyze_happy_path_is_model_backed_with_verified_locations(monkeypatch):
    calls = _install(monkeypatch, [_ok(REVIEW)])
    out = _run(singularity_router.analyze_code(singularity_router.AnalyzeRequest(code=CODE), _request()))

    assert out["success"] is True
    analysis = out["analysis"]
    assert analysis["mode"] == "model" and analysis["receipt_id"] == "rcpt-l35"
    assert len(analysis["findings"]) == 1
    finding = analysis["findings"][0]
    assert finding["source"] == "model" and finding["line"] == 2 and finding["severity"] == "high"
    assert analysis["findings_dropped_unverified"] == 1
    assert all(f["source"] == "static" for f in analysis["static_findings"])
    assert "quality_score" not in analysis and "raw_analysis" not in analysis
    assert "model" not in calls[0]  # no model pin; the shared lane decides
    assert calls[0]["schema"] is review_core.CodeReview


def test_analyze_model_unavailable_is_503_static_only(monkeypatch):
    _install(monkeypatch, [_unavailable()])
    resp = _run(singularity_router.analyze_code(
        singularity_router.AnalyzeRequest(code="def f():\n    try:\n        x()\n    except:\n        pass\n"),
        _request()))
    assert resp.status_code == 503
    body = json.loads(resp.body)
    assert body["success"] is False and body["mode"] == "fallback_static_only"
    assert body["static_findings"] and all(f["source"] == "static" for f in body["static_findings"])
    assert "findings" not in body
    status = _run(singularity_router.singularity_status())["data"]
    assert status["status"] == "degraded" and "model_code_review" not in status["capabilities"]


def test_file_path_requires_admin_and_stays_in_source_tree(monkeypatch):
    calls = _install(monkeypatch, [])
    with pytest.raises(HTTPException) as exc:
        _run(singularity_router.analyze_code(
            singularity_router.AnalyzeRequest(file_path="modules/singularity.py"), _request()))
    assert exc.value.status_code == 403
    for path in ("/proc/self/environ", "/etc/hostname", "../../../../etc/passwd"):
        with pytest.raises(HTTPException) as exc:
            _run(singularity_router.analyze_code(
                singularity_router.AnalyzeRequest(file_path=path), _request(admin=True)))
        assert exc.value.status_code in {403, 404, 422}
    assert calls == []

    text, label = review_core.read_review_file("modules/singularity.py")
    assert "def static_checks" in text and label == "cortex_server/modules/singularity.py"


def test_analyze_contract_validation():
    with pytest.raises(HTTPException) as exc:
        _run(singularity_router.analyze_code(singularity_router.AnalyzeRequest(), _request()))
    assert exc.value.status_code == 422
    with pytest.raises(HTTPException) as exc:
        _run(singularity_router.analyze_code(
            singularity_router.AnalyzeRequest(code="x=1", scope="deep"), _request()))
    assert exc.value.status_code == 422


def test_improve_returns_diff_and_never_applies(monkeypatch):
    proposal = {"improved_code": "def f(a: int) -> int:\n    return a + 1\n",
                "changes": [{"what": "type hints", "why": "goal"}], "diff_summary": "Added hints."}
    _install(monkeypatch, [_ok(proposal)])
    out = _run(singularity_router.improve_code(
        singularity_router.ImproveRequest(code="def f(a):\n    return a + 1\n", goal="add type hints"), _request()))
    assert out["success"] is True and out["applied"] is False
    assert out["improvement"]["diff"].startswith("--- original")
    assert out["improvement"]["syntax_ok"] is True
    metrics = _run(singularity_router.get_metrics())["data"]
    assert metrics["improvements_applied"] == 0 and metrics["improvement_proposals"] == 1


def test_improve_model_unavailable_returns_no_code(monkeypatch):
    _install(monkeypatch, [_unavailable("timeout")])
    resp = _run(singularity_router.improve_code(
        singularity_router.ImproveRequest(code="def f(a):\n    return a\n"), _request()))
    assert resp.status_code == 503
    body = json.loads(resp.body)
    assert body["success"] is False and body["improvement"] is None


def test_static_checks_are_ast_based_and_labelled():
    result = review_core.static_checks("import os\ndef run(cmd, opts={}):\n    os.system(cmd)\n")
    descriptions = " ".join(f["description"] for f in result["findings"])
    assert "os.system" in descriptions and "Mutable default" in descriptions
    assert all(f["source"] == "static" for f in result["findings"])
    broken = review_core.static_checks("def f(:\n")
    assert broken["parsed"] is False and broken["findings"][0]["line"] == 1


def test_no_pinned_codex_model_in_source():
    for module in (singularity_router, review_core):
        assert "gpt-5.3-codex" not in Path(module.__file__).read_text()


def test_adapter_reviews_fenced_code(monkeypatch):
    _install(monkeypatch, [_ok(REVIEW)])
    out = _run(review_adapter.run(f"Please review:\n```python\n{CODE}```", {"principal_scope_key": "p:1"}))
    assert out["operation"] == "singularity.review" and out["origin"] == "model"
    assert out["data"]["findings"][0]["line"] == 2
    assert 0 < len(out["summary"]) <= 1500


def test_adapter_blocks_without_code_or_model(monkeypatch):
    calls = _install(monkeypatch, [_unavailable()])
    with pytest.raises(ExecutionBlocked) as exc:
        _run(review_adapter.run("how is my code?", {"principal_scope_key": "p:1"}))
    assert exc.value.reason == "no_code_supplied" and calls == []
    with pytest.raises(ExecutionBlocked):
        _run(review_adapter.run("x", {"principal_scope_key": "p:1", "code": CODE}))
