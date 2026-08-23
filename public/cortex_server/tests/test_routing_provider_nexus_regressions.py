from __future__ import annotations

import json
import time

import pytest

from cortex_server.modules import consciousness_integration as consciousness
from cortex_server.modules.fractal_executor import (
    aggregate_fractal_results,
    build_fractal_plan,
)
from cortex_server.routers import nexus


class _ProviderResponse:
    def __init__(self, content, *, model="policy-owner/model-v7", finish_reason="stop"):
        self._content = content
        self._model = model
        self._finish_reason = finish_reason

    def raise_for_status(self):
        return None

    def json(self):
        return {
            "model": self._model,
            "choices": [
                {
                    "message": {"content": self._content},
                    "finish_reason": self._finish_reason,
                }
            ],
        }


def test_nexus_semantic_provider_rejects_empty_object_and_uses_standing_policy(
    monkeypatch,
):
    observed = {}

    def provider_call(url, *, headers, json, timeout):
        observed.update(url=url, headers=headers, payload=json, timeout=timeout)
        return _ProviderResponse("{}")

    monkeypatch.setattr(nexus, "OPENROUTER_API_KEY", "test-only-key")
    monkeypatch.setattr(
        nexus,
        "load_openclaw_config",
        lambda: {
            "runtime": {
                "provider": "openrouter",
                "base_model": "openrouter/policy-owner/model-v7",
            }
        },
    )
    monkeypatch.setattr(nexus.requests, "post", provider_call)

    result = nexus.analyze_intent_with_oracle(
        "route this",
        deadline_monotonic=time.monotonic() + 0.75,
    )

    assert result["method"] == "invalid_schema"
    assert result["confidence"] == 0
    assert result["intents"] == []
    assert result["levels"] == []
    assert observed["payload"]["model"] == "policy-owner/model-v7"
    assert 0 < observed["timeout"] < 0.75


def test_nexus_semantic_provider_requires_complete_typed_schema(monkeypatch):
    payload = {
        "intents": ["data_analysis"],
        "levels": [5, 34],
        "confidence": 0.83,
        "reasoning": "The request needs analysis and validation.",
    }
    monkeypatch.setattr(nexus, "OPENROUTER_API_KEY", "test-only-key")
    monkeypatch.setattr(
        nexus,
        "load_openclaw_config",
        lambda: {"runtime": {"provider": "openrouter", "base_model": "vendor/model"}},
    )
    monkeypatch.setattr(
        nexus.requests,
        "post",
        lambda *_args, **_kwargs: _ProviderResponse(
            json.dumps(payload), model="vendor/model"
        ),
    )

    result = nexus.analyze_intent_with_oracle("analyze this")

    assert result == {**payload, "confidence": 0.83, "method": "oracle_semantic"}


def test_nexus_converts_propagated_absolute_deadline_into_semantic_budget():
    request = type(
        "Request",
        (),
        {"headers": {"x-cortex-deadline-ms": str(int(time.time() * 1000) + 500)}},
    )()
    deadline = nexus._oracle_semantic_deadline(
        request,
        started_monotonic=time.monotonic(),
        latency_plan={"max_latency_ms": 5_000},
    )
    remaining = deadline - time.monotonic()
    assert 0 < remaining <= 0.5


@pytest.mark.parametrize(
    "response",
    [
        _ProviderResponse(
            '{"intents":["data_analysis"],"levels":[5],"confidence":0.8,"reasoning":"analysis"}',
            model="substituted/model",
        ),
        _ProviderResponse(
            '{"intents":["data_analysis"],"levels":[5],"confidence":0.8,"reasoning":"analysis"}',
            model="vendor/model",
            finish_reason="length",
        ),
    ],
)
def test_nexus_semantic_provider_rejects_model_substitution_and_incomplete_output(
    monkeypatch, response
):
    monkeypatch.setattr(nexus, "OPENROUTER_API_KEY", "test-only-key")
    monkeypatch.setattr(
        nexus,
        "load_openclaw_config",
        lambda: {"runtime": {"provider": "openrouter", "base_model": "vendor/model"}},
    )
    monkeypatch.setattr(nexus.requests, "post", lambda *_args, **_kwargs: response)

    result = nexus.analyze_intent_with_oracle("analyze this")

    assert result["method"] == "provider_error"
    assert result["confidence"] == 0


def test_trainable_outcome_receipt_requires_output_user_outcome_and_executed_subset(
    monkeypatch,
):
    scope = {
        "tenant_id": "tenant-a",
        "workspace_id": "workspace-a",
        "agent_id": "agent-a",
        "user_id": "user-a",
        "channel_id": "channel-a",
        "session_id": "session-a",
        "scope_credential_id": "credential-a",
        "storage_workspace_id": "workspace-a",
    }
    common = {
        "scope": scope,
        "execution_id": "execution-a",
        "query": "Produce the verified answer.",
        "task_archetype": "planning",
        "policy_label": "architecture",
        "codec_variant": "query_only",
        "validator_pass": True,
        "recovery_needed": False,
        "latency_ms": 25,
        "outcome_confidence": 0.9,
        "selected_levels": [9, 24, 34],
        "plan_digest": "d" * 64,
    }
    with pytest.raises(ValueError, match="verified_output_required"):
        nexus._issue_outcome_feedback_receipt(
            **common,
            output="",
            user_outcome="accepted",
            executed_levels=[9, 24],
        )
    with pytest.raises(ValueError, match="executed_levels_not_selected"):
        nexus._issue_outcome_feedback_receipt(
            **common,
            output="Observed answer",
            user_outcome="accepted",
            executed_levels=[5, 24],
        )

    issued = nexus._issue_outcome_feedback_receipt(
        **common,
        output="Observed answer",
        user_outcome="accepted",
        executed_levels=[9, 24],
    )
    monkeypatch.setattr(nexus, "_assurance_scope", lambda _request: scope)
    verified = nexus._verify_outcome_feedback_receipt(issued["receipt"], object())
    assert verified["trainable"] is True
    assert verified["output_observed"] is True
    assert verified["activation_complete"] is True
    assert verified["executed_levels"] == [9, 24]
    assert verified["user_outcome"] == "accepted"


def test_fractal_repeated_sibling_tasks_keep_unique_path_ids_and_exact_coverage():
    plan = build_fractal_plan("repeat and repeat", max_depth=2)
    leaf_ids = [leaf["node_id"] for leaf in plan["leaves"]]
    assert len(leaf_ids) == 6
    assert len(set(leaf_ids)) == len(leaf_ids)

    partial_results = [
        {"node_id": node_id, "summary": f"result-{index}"}
        for index, node_id in enumerate(leaf_ids[:3])
    ]
    aggregate = aggregate_fractal_results(plan, partial_results)
    assert aggregate["covered_leaves"] == 3
    assert aggregate["total_leaves"] == 6
    assert aggregate["coverage"] == 0.5
    assert aggregate["success"] is False

    with pytest.raises(ValueError, match="duplicate node IDs"):
        aggregate_fractal_results(plan, [partial_results[0], partial_results[0]])


class _FakeChainResponse:
    def raise_for_status(self):
        return None

    def json(self):
        return {"success": True}


class _FakeChainClient:
    calls = []

    def __init__(self, *, timeout):
        self.timeout = timeout

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return None

    async def post(self, url, *, json, headers):
        self.calls.append({"url": url, "json": json, "headers": dict(headers)})
        return _FakeChainResponse()

    async def get(self, url, *, params, headers):
        self.calls.append({"url": url, "params": params, "headers": dict(headers)})
        return _FakeChainResponse()


async def _invoke_chain_middleware(headers, nested_call):
    response_events = []

    async def endpoint(_scope, _receive, send):
        result = await nested_call()
        body = json.dumps({"result": result}).encode("utf-8")
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": body})

    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(event):
        response_events.append(event)

    app = consciousness.ChainContextMiddleware(endpoint)
    await app(
        {
            "type": "http",
            "method": "POST",
            "path": "/internal",
            "headers": [(key.encode("latin-1"), value.encode("latin-1")) for key, value in headers.items()],
        },
        receive,
        send,
    )
    return response_events


def _signed_chain_headers(headers):
    signed = dict(headers)
    signed[consciousness._CHAIN_SIGNATURE_HEADER] = consciousness._chain_context_signature(
        signed
    )
    return signed


@pytest.mark.asyncio
async def test_chain_context_crosses_request_boundary_and_stops_a_b_a_cycle(
    monkeypatch,
):
    _FakeChainClient.calls = []
    terminal_reasons = []

    class _Bus:
        def broadcast(self, _source, event_type, data):
            if event_type == "chain_error":
                terminal_reasons.append(data["terminal_reason"])

    monkeypatch.setattr(consciousness.httpx, "AsyncClient", _FakeChainClient)
    monkeypatch.setattr(consciousness, "_get_bus", lambda: _Bus())

    first = await consciousness.chain_to("alpha", "beta/work", {"value": 1})
    assert first == {"success": True}
    assert len(_FakeChainClient.calls) == 1
    propagated_headers = _FakeChainClient.calls[0]["headers"]
    assert propagated_headers["x-cortex-chain-visited"] == "alpha,beta"
    assert propagated_headers["x-cortex-chain-depth"] == "1"

    await _invoke_chain_middleware(
        propagated_headers,
        lambda: consciousness.chain_to("beta", "alpha/work", {"value": 2}),
    )

    assert len(_FakeChainClient.calls) == 1
    assert terminal_reasons[-1] == "cycle_detected"


@pytest.mark.asyncio
async def test_chain_context_canonicalizes_router_aliases_without_weakening_source_check(
    monkeypatch,
):
    _FakeChainClient.calls = []
    monkeypatch.setattr(consciousness.httpx, "AsyncClient", _FakeChainClient)
    monkeypatch.setattr(consciousness, "configured_internal_memory_headers", lambda: {})

    first = await consciousness.chain_to("awareness", "browser/search", {"query": "status"})
    assert first == {"success": True}
    propagated_headers = _FakeChainClient.calls[0]["headers"]
    assert propagated_headers["x-cortex-chain-visited"] == "awareness,ghost"

    nested = []

    async def nested_call():
        nested.append(
            await consciousness.chain_to(
                "ghost",
                "librarian/embed",
                {"text": "bounded cache record"},
            )
        )

    await _invoke_chain_middleware(propagated_headers, nested_call)

    assert nested == [{"success": True}]
    assert len(_FakeChainClient.calls) == 2
    assert _FakeChainClient.calls[1]["headers"]["x-cortex-chain-visited"] == (
        "awareness,ghost,librarian"
    )


@pytest.mark.asyncio
async def test_chain_memory_credentials_failure_emits_a_terminal_reason(monkeypatch):
    _FakeChainClient.calls = []
    terminal_reasons = []

    class _Bus:
        def broadcast(self, _source, event_type, data):
            if event_type == "chain_error":
                terminal_reasons.append(data["terminal_reason"])

    monkeypatch.setattr(consciousness.httpx, "AsyncClient", _FakeChainClient)
    monkeypatch.setattr(consciousness, "configured_internal_memory_headers", lambda: None)
    monkeypatch.setattr(consciousness, "_get_bus", lambda: _Bus())

    result = await consciousness.chain_to(
        "awareness",
        "librarian/embed",
        {"text": "bounded record"},
    )

    assert result is None
    assert _FakeChainClient.calls == []
    assert terminal_reasons[-1] == "memory_credentials_unavailable"


@pytest.mark.asyncio
async def test_inherited_chain_depth_and_deadline_stop_before_network(monkeypatch):
    _FakeChainClient.calls = []
    terminal_reasons = []

    class _Bus:
        def broadcast(self, _source, event_type, data):
            if event_type == "chain_error":
                terminal_reasons.append(data["terminal_reason"])

    monkeypatch.setattr(consciousness.httpx, "AsyncClient", _FakeChainClient)
    monkeypatch.setattr(consciousness, "_get_bus", lambda: _Bus())
    depth_headers = {
        "x-cortex-chain-id": "depth-chain",
        "x-cortex-chain-visited": ",".join(f"level{index}" for index in range(9)),
        "x-cortex-chain-depth": "8",
        "x-cortex-chain-deadline-ms": str(int(time.time() * 1000) + 10_000),
    }
    await _invoke_chain_middleware(
        _signed_chain_headers(depth_headers),
        lambda: consciousness.chain_to("level8", "fresh/work"),
    )
    assert _FakeChainClient.calls == []
    assert terminal_reasons[-1] == "max_depth_exceeded"

    deadline_headers = {
        "x-cortex-chain-id": "deadline-chain",
        "x-cortex-chain-visited": "alpha,beta",
        "x-cortex-chain-depth": "1",
        "x-cortex-chain-deadline-ms": str(int(time.time() * 1000) - 1),
    }
    await _invoke_chain_middleware(
        _signed_chain_headers(deadline_headers),
        lambda: consciousness.chain_to("beta", "gamma/work"),
    )
    assert _FakeChainClient.calls == []
    assert terminal_reasons[-1] == "deadline_exhausted"


@pytest.mark.asyncio
async def test_chain_middleware_rejects_unsigned_provenance_but_allows_request_deadline():
    called = []

    async def unsigned_target():
        called.append("unsigned")
        return {"success": True}

    async def deadline_target():
        called.append("deadline-only")
        return {"success": True}

    unsigned = {
        "x-cortex-chain-id": "untrusted-chain",
        "x-cortex-chain-visited": "alpha,beta",
        "x-cortex-chain-depth": "1",
        "x-cortex-chain-deadline-ms": str(int(time.time() * 1000) + 10_000),
    }
    rejected = await _invoke_chain_middleware(
        unsigned,
        unsigned_target,
    )
    assert called == []
    assert next(event["status"] for event in rejected if event["type"] == "http.response.start") == 400

    allowed = await _invoke_chain_middleware(
        {"x-cortex-chain-deadline-ms": str(int(time.time() * 1000) + 10_000)},
        deadline_target,
    )
    assert called == ["deadline-only"]
    assert next(event["status"] for event in allowed if event["type"] == "http.response.start") == 200


@pytest.mark.asyncio
async def test_explicit_chain_context_cannot_understate_depth_or_source(monkeypatch):
    _FakeChainClient.calls = []
    terminal_reasons = []

    class _Bus:
        def broadcast(self, _source, event_type, data):
            if event_type == "chain_error":
                terminal_reasons.append(data["terminal_reason"])

    monkeypatch.setattr(consciousness.httpx, "AsyncClient", _FakeChainClient)
    monkeypatch.setattr(consciousness, "_get_bus", lambda: _Bus())
    result = await consciousness.chain_to(
        "beta",
        "gamma/work",
        chain_context={
            "chain_id": "forged-depth",
            "visited_levels": ["alpha", "beta"],
            "depth": 0,
            "deadline_epoch_ms": int(time.time() * 1000) + 10_000,
        },
    )
    assert result is None
    assert _FakeChainClient.calls == []
    assert terminal_reasons[-1] == "source_context_mismatch"
