"""L16 Academy repair: model-backed learn/teach, verified evidence, durable principal store."""

import asyncio
import json
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from cortex_server.modules import academy as academy_core
from cortex_server.modules import level_model
from cortex_server.modules.execution_engine import ExecutionBlocked
from cortex_server.modules.level_adapters import academy as academy_adapter
from cortex_server.routers import academy as academy_router


def _run(coro):
    return asyncio.run(coro)


def _request(scope=None):
    principal = None
    if scope is not None:
        principal = SimpleNamespace(isolation_key=lambda name, _s=scope: f"{_s}:{name}")
    return SimpleNamespace(state=SimpleNamespace(authenticated_memory_principal=principal), headers={})


def _ok(data):
    return {"status": "ok", "ok": True, "level": 16, "name": "academy", "elapsed_ms": 5,
            "origin": "model", "data": data, "model": "gpt-5.6-sol", "receipt_id": "rcpt-l16",
            "provider_invoked": True, "attempts": 1}


def _unavailable(status="model_unavailable"):
    return {"status": status, "ok": False, "level": 16, "name": "academy", "elapsed_ms": 5,
            "origin": "model_unavailable", "label": level_model.LEVEL_MODEL_UNAVAILABLE_LABEL,
            "error": "provider down"}


MODULE = {
    "summary": "How evidence updates a belief.",
    "key_concepts": [
        {"name": "Prior", "explanation": "Belief before evidence."},
        {"name": "Likelihood", "explanation": "Probability of the evidence given the hypothesis."},
        {"name": "Posterior", "explanation": "Updated belief after evidence."},
    ],
    "misconceptions": [{"misconception": "The prior does not matter", "correction": "It does with weak data."}],
    "exercises": [{"prompt": "Update a 1% prior with a 90% sensitive test", "solution_sketch": "Apply Bayes' rule."}],
    "assessment": [{"question": "What is a posterior?", "answer": "The updated belief."}],
    "sources_needed": False,
}
CONTENT = ("Retries must be idempotent. Use idempotency keys stored server-side. "
           "Timeouts should be shorter than client deadlines.")
EXTRACTION = {
    "patterns": [
        {"statement": "Retries need idempotency", "evidence_quote": "Retries must be idempotent."},
        {"statement": "Use exponential backoff", "evidence_quote": "Always back off exponentially."},
    ],
    "relations": [{"source": "retries", "relation": "require", "target": "idempotency keys"}],
    "insights": ["Store idempotency keys server-side."],
    "suggested_tags": ["Reliability"],
}


@pytest.fixture(autouse=True)
def _isolated_store(tmp_path, monkeypatch):
    academy_core.set_store_for_tests(academy_core.AcademyStore(tmp_path / "academy.sqlite3"))
    monkeypatch.setattr(academy_core, "_stats", {
        "since": "test", "model_calls": 0, "model_successes": 0, "model_failures": 0,
        "last_model_status": None, "last_model_at": None, "last_model_success_at": None,
        "cache_hits": 0, "cache_misses": 0, "patterns_dropped_unverified": 0,
    })
    yield
    academy_core.set_store_for_tests(None)


def _install(monkeypatch, results):
    calls = []
    seq = iter(results)

    async def fake(**kwargs):
        calls.append(kwargs)
        return next(seq)

    monkeypatch.setattr(level_model, "level_model_json", fake)
    return calls


def test_learn_happy_path_has_receipt_no_made_up_confidence_and_caches(monkeypatch):
    calls = _install(monkeypatch, [_ok(MODULE)])
    req = academy_router.LearnRequest(topic="Bayesian updating", depth="beginner")
    out = _run(academy_router.academy_learn(req, _request()))

    assert out["success"] is True and out["origin"] == "model"
    assert out["receipt_id"] == "rcpt-l16" and out["module"]["key_concepts"][0]["name"] == "Prior"
    assert "confidence" not in json.dumps(out["provenance"])
    assert out["persisted"] is True and out["store"] == "sqlite"
    assert calls[0]["schema"] is academy_core.LearningModule

    again = _run(academy_router.academy_learn(req, _request()))
    assert again["cached"] is True and again["module"] == out["module"]
    assert len(calls) == 1
    status = _run(academy_router.academy_status())
    assert status["oracle_calls"] == 1 and status["cache_hits"] == 1
    assert status["store"]["durable"] is True and status["degraded"] is False


def test_learn_model_unavailable_is_honest(monkeypatch):
    _install(monkeypatch, [_unavailable()])
    out = _run(academy_router.academy_learn(academy_router.LearnRequest(topic="Bayesian updating"), _request()))
    assert out["success"] is False and out["module"] is None
    assert out["origin"] == "model_unavailable"
    assert "confidence" not in json.dumps(out)
    status = _run(academy_router.academy_status())
    assert status["degraded"] is True and status["model_health"] == "degraded"
    assert "model_learning_modules" not in status["capabilities"]


def test_learn_rejects_malformed_input(monkeypatch):
    calls = _install(monkeypatch, [])
    with pytest.raises(ValidationError):
        academy_router.LearnRequest(topic="x", depth="galaxy-brain")
    with pytest.raises(ValidationError):
        academy_router.LearnRequest()
    with pytest.raises(HTTPException) as exc:
        _run(academy_router.academy_learn(academy_router.LearnRequest(topic="\x00\x07 "), _request()))
    assert exc.value.status_code == 422
    assert calls == []


def test_learn_sanitizes_control_characters(monkeypatch):
    calls = _install(monkeypatch, [_ok(MODULE)])
    _run(academy_router.academy_learn(academy_router.LearnRequest(topic="a\u0000b\u0007c"), _request()))
    assert "<topic>abc</topic>" in calls[0]["prompt"]


def test_teach_keeps_only_verbatim_evidence_and_persists_per_principal(monkeypatch, tmp_path):
    _install(monkeypatch, [_ok(EXTRACTION)])
    req = academy_router.TeachRequest(content=CONTENT, tags=["reliability"])
    out = _run(academy_router.academy_teach(req, _request("alice")))

    assert out["success"] is True and out["receipt_id"] == "rcpt-l16"
    assert [p["evidence_quote"] for p in out["patterns_extracted"]] == ["Retries must be idempotent."]
    assert all(p["evidence_quote"] in CONTENT for p in out["patterns_extracted"])
    assert out["evidence"] == {"patterns_returned": 2, "patterns_verified": 1, "verified_fraction": 0.5}
    assert out["persisted"] is True and out["knowledge_base_size"] == 1

    alice = _run(academy_router.academy_patterns(_request("alice")))
    assert alice["total_knowledge_entries"] == 1
    assert alice["patterns"][0]["patterns"][0]["statement"] == "Retries need idempotency"
    bob = _run(academy_router.academy_patterns(_request("bob")))
    assert bob["total_knowledge_entries"] == 0 and bob["patterns"] == []

    # A fresh store on the same file (a restart) still has the entry.
    reopened = academy_core.AcademyStore(tmp_path / "academy.sqlite3")
    assert len(reopened.list_teach("alice:level.academy.v1")) == 1


def test_teach_with_no_verifiable_patterns_stores_nothing(monkeypatch):
    bad = {**EXTRACTION, "patterns": [{"statement": "Invented", "evidence_quote": "not in the material"}]}
    _install(monkeypatch, [_ok(bad)])
    out = _run(academy_router.academy_teach(academy_router.TeachRequest(content=CONTENT), _request("alice")))
    assert out["success"] is False and out["error"] == "no_verifiable_patterns"
    assert academy_core.get_store().counts()["teach_entries"] == 0


def test_teach_model_unavailable_and_oversize_content(monkeypatch):
    calls = _install(monkeypatch, [_unavailable("timeout")])
    out = _run(academy_router.academy_teach(academy_router.TeachRequest(content="z" * 100_000), _request()))
    assert out["success"] is False and out["origin"] == "model_unavailable"
    assert out["patterns_extracted"] == []
    assert out["content_length"] == academy_core.MAX_CONTENT_CHARS and out["truncated"] is True
    assert len(calls[0]["prompt"]) < academy_core.MAX_CONTENT_CHARS + 100


def test_store_falls_back_to_memory_and_status_says_so(tmp_path):
    blocker = tmp_path / "not_a_dir"
    blocker.write_text("x")
    store = academy_core.AcademyStore(blocker / "academy.sqlite3")
    assert store.kind == "in_memory" and store.durable is False
    academy_core.set_store_for_tests(store)
    status = _run(academy_router.academy_status())
    assert status["store"]["kind"] == "in_memory"
    assert "in_memory_principal_store" in status["capabilities"]
    assert status["degraded"] is True


def test_adapter_learn_mode_and_extract_mode_do_not_persist(monkeypatch):
    _install(monkeypatch, [_ok(MODULE), _ok(EXTRACTION)])
    learned = _run(academy_adapter.run("Explain Bayesian updating for a beginner",
                                       {"principal_scope_key": "p:1"}))
    assert learned["operation"] == "academy.learn" and learned["origin"] == "model"
    assert learned["data"]["depth"] == "beginner" and learned["receipt_id"] == "rcpt-l16"
    assert 0 < len(learned["summary"]) <= 1500

    material = CONTENT + " " + ("Additional operational notes about retries. " * 12)
    extracted = _run(academy_adapter.run(material, {"principal_scope_key": "p:1"}))
    assert extracted["operation"] == "academy.extract"
    assert extracted["data"]["patterns"][0]["evidence_quote"] == "Retries must be idempotent."
    assert academy_core.get_store().counts() == {"teach_entries": 0, "learn_modules": 0}


def test_adapter_blocks_when_model_unavailable_or_scope_missing(monkeypatch):
    _install(monkeypatch, [_unavailable()])
    with pytest.raises(ExecutionBlocked):
        _run(academy_adapter.run("Explain TCP slow start", {"principal_scope_key": "p:1"}))
    with pytest.raises(ExecutionBlocked):
        _run(academy_adapter.run("Explain TCP slow start", {}))
