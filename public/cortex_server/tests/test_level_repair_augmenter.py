"""L38 Augmenter repair: no fabricated citations, ok only when valid, honest status."""

import asyncio
import json
from types import SimpleNamespace

import pytest

from cortex_server.modules import augmenter as core
from cortex_server.modules import level_model
from cortex_server.modules.execution_engine import ExecutionBlocked
from cortex_server.modules.level_adapters import augmenter as augmenter_adapter
from cortex_server.routers import augmenter as augmenter_router
from cortex_server.routers import nexus


def _run(coro):
    return asyncio.run(coro)


def _request():
    return SimpleNamespace(state=SimpleNamespace(), headers={})


@pytest.fixture(autouse=True)
def _isolate(monkeypatch):
    monkeypatch.delenv("AUGMENTER_ENABLED", raising=False)
    monkeypatch.setattr(core, "STATS", core.AugmenterStats())
    monkeypatch.setattr(nexus, "_authenticated_nexus_principal",
                        lambda *_a, **_k: (SimpleNamespace(session_id="s-1"), None))

    class _NoHTTP:
        def __init__(self, *_a, **_k):
            raise AssertionError("augmenter must not make HTTP self-calls in these paths")

    monkeypatch.setattr(augmenter_router.httpx, "AsyncClient", _NoHTTP)


def _oracle(monkeypatch, answers):
    calls = []
    seq = iter(answers)

    async def fake(prompt, response_mode, priority, timeout_s, *, headers=None, system=None):
        calls.append({"prompt": prompt, "system": system, "headers": headers})
        nxt = next(seq)
        if isinstance(nxt, Exception):
            raise nxt
        return nxt

    monkeypatch.setattr(augmenter_router, "_call_oracle", fake)
    return calls


def _chat(prompt, **kw):
    return _run(augmenter_router.chat(augmenter_router.AugmenterChatRequest(prompt=prompt, **kw), _request()))


def test_missing_citation_is_reported_not_appended(monkeypatch):
    calls = _oracle(monkeypatch, ["2 + 2 = 4.", "It is 4."])
    out = _chat("In one sentence, what is 2+2? Source: docs/fake.md#L1-3")
    assert out["ok"] is False
    assert "Source:" not in out["response"]
    validation = out["augmenter"]["validation"]
    assert validation["ok"] is False and validation["why"] == "citation:missing_after_repair"
    assert validation["citation_missing"] == ["docs/fake.md#L1-3"]
    assert out["done"] is False and out["origin"] == "augmenter_validation_failed"
    assert len(calls) == 2


def test_genuine_citation_passes(monkeypatch):
    _oracle(monkeypatch, ["The answer is 4. Source: docs/math.md#L1-3"])
    out = _chat("What is 2+2? Source: docs/math.md#L1-3")
    assert out["ok"] is True and out["augmenter"]["repairs"] == 0


def test_failed_validation_without_repair_is_not_ok(monkeypatch):
    _oracle(monkeypatch, ["Sure, I would call the weather tool for Paris."])
    out = _chat("Return only JSON with keys function and arguments to call get_weather for Paris.",
                latency_budget_ms=500)
    assert out["ok"] is False
    assert out["augmenter"]["validation"]["why"] == "format:invalid_json"
    assert out["augmenter"]["repairs"] == 0


def test_tool_json_repair_success(monkeypatch):
    _oracle(monkeypatch, ["I'd call get_weather.", '{"function": "get_weather", "arguments": {"city": "Paris"}}'])
    out = _chat("Return ONLY JSON with keys function and arguments to call get_weather for Paris.")
    assert out["ok"] is True and out["augmenter"]["repairs"] == 1
    assert json.loads(out["response"])["arguments"] == {"city": "Paris"}


def test_python_code_contract_is_validated(monkeypatch):
    _oracle(monkeypatch, ["```python\ndef add(a, b):\n    return a +\n```",
                          "```python\ndef add(a, b):\n    return a + b\n```"])
    out = _chat("Write a python function that adds two numbers")
    assert out["augmenter"]["decision"]["kind"] == "code"
    assert out["ok"] is True and out["augmenter"]["repairs"] == 1


def test_oracle_failure_is_ok_false_and_status_degrades(monkeypatch):
    _oracle(monkeypatch, [RuntimeError("down")] * 6)
    for _ in range(3):
        out = _chat("hello there")
        assert out["ok"] is False and out["response"] == ""
    status = _run(augmenter_router.status())
    assert status["degraded"] is True and status["degraded_reasons"]
    assert status["stats"]["oracle_failures"] == 3


def test_disabled_flag_is_honoured(monkeypatch):
    monkeypatch.setenv("AUGMENTER_ENABLED", "false")
    calls = _oracle(monkeypatch, [])
    resp = _run(augmenter_router.chat(augmenter_router.AugmenterChatRequest(prompt="hi"), _request()))
    assert resp.status_code == 503 and json.loads(resp.body)["error"] == "augmenter_disabled"
    assert calls == []
    status = _run(augmenter_router.status())
    assert status["enabled"] is False and status["degraded"] is True


def test_ops_prompt_uses_in_process_sentinel_and_simulator(monkeypatch):
    from cortex_server.routers import sentinel

    async def fake_sentinel_status():
        return {"status": "active", "health_reason": "ok", "active_watchers": 2, "latest_scan_issues": 0}

    async def fake_sim(prompt, mode, scope_key):
        return {"success": True, "probability_basis": "model_estimate",
                "outcomes": [{"label": "most_likely", "probability": "60%", "key_events": ["a", "b"],
                              "timeline": "1w", "impact_assessment": "moderate"}]}

    monkeypatch.setattr(sentinel, "sentinel_status", fake_sentinel_status)
    monkeypatch.setattr(augmenter_router, "_simulate_in_process", fake_sim)
    calls = _oracle(monkeypatch, ["Step 1: back up. Step 2: migrate. Step 3: verify; rollback plan ready."])
    out = _chat("Plan a production database migration rollout with a rollback plan")
    notes = out["augmenter"]["notes"]
    assert "sentinel_snapshot_ok" in notes and "simulator_ok:fast" in notes
    assert "[L21 Sentinel" in calls[0]["system"] and "[L20 Simulator" in calls[0]["system"]
    assert out["ok"] is True


def test_ordinary_words_do_not_trigger_ops_preflight():
    assert not core.is_ops_intent("What is the latency of this database schema? Any risk?")
    assert core.is_ops_intent("Write a rollback plan for the database migration")


def test_adapter_contract_guidance_without_draft():
    out = _run(augmenter_adapter.run("Answer with the option letter only. A) 1 B) 2", {}))
    assert out["operation"] == "augmenter.contract" and out["origin"] == "deterministic"
    assert out["data"]["contract"] == "choice_letter"


def test_adapter_flags_citation_not_in_evidence_and_repairs(monkeypatch):
    calls = []

    async def fake(**kwargs):
        calls.append(kwargs)
        return {"status": "ok", "ok": True, "text": "4. Source: docs/math.md#L1-3", "model": "gpt-5.6-sol",
                "receipt_id": "rcpt-l38", "elapsed_ms": 3}

    monkeypatch.setattr(level_model, "level_model_json", fake)
    ctx = {"principal_scope_key": "p:1", "draft_answer": "4. Source: docs/invented.md#L9",
           "evidence_citations": ["docs/math.md#L1-3"]}
    out = _run(augmenter_adapter.run("What is 2+2?", ctx))
    assert out["operation"] == "augmenter.repair" and out["origin"] == "model"
    assert out["data"]["initial"]["why"] == "citation:not_in_evidence"
    assert out["data"]["ok"] is True and out["receipt_id"] == "rcpt-l38"
    assert calls[0]["schema"] is None


def test_adapter_blocks_when_repair_model_unavailable_or_disabled(monkeypatch):
    async def fake(**_kwargs):
        return {"status": "timeout", "ok": False}

    monkeypatch.setattr(level_model, "level_model_json", fake)
    ctx = {"principal_scope_key": "p:1", "draft_answer": "not json"}
    with pytest.raises(ExecutionBlocked):
        _run(augmenter_adapter.run("Return ONLY JSON with keys function and arguments", ctx))
    monkeypatch.setenv("AUGMENTER_ENABLED", "false")
    with pytest.raises(ExecutionBlocked) as exc:
        _run(augmenter_adapter.run("anything", {}))
    assert exc.value.reason == "augmenter_disabled"
