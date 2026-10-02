import asyncio
import json
from types import SimpleNamespace

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from cortex_server.routers import oracle, oracle_sandbox


@pytest.fixture(autouse=True)
def _clear_oracle_singleflight_state():
    oracle._OPENCLAW_INFLIGHT.clear()
    oracle._OPENCLAW_RATE_LIMITS.clear()
    yield
    oracle._OPENCLAW_INFLIGHT.clear()
    oracle._OPENCLAW_RATE_LIMITS.clear()


def _openclaw_stdout(text="provider answer", model="gpt-5", provider="openrouter", agent="oracle"):
    return json.dumps(
        {
            "result": {
                "payloads": [{"text": text}],
                "meta": {
                    "agentMeta": {
                        "model": model,
                        "provider": provider,
                        "agentId": agent,
                    }
                },
            }
        }
    )


def test_openclaw_command_binds_config_system_and_actual_identity(monkeypatch):
    captured = {}

    def fake_run(command, **_kwargs):
        captured["command"] = command
        return SimpleNamespace(
            returncode=0,
            stdout=_openclaw_stdout(),
            stderr="",
        )

    monkeypatch.setattr(oracle, "OPENCLAW_BIN", "/configured/openclaw")
    monkeypatch.setattr(oracle, "ORACLE_OPENCLAW_AGENT", "oracle")
    monkeypatch.setattr(oracle, "ORACLE_OPENCLAW_MAX_ATTEMPTS", 1)
    monkeypatch.setattr(oracle.subprocess, "run", fake_run)
    monkeypatch.setattr(oracle.time, "sleep", lambda _seconds: None)

    result = oracle.call_openclaw_local(
        "PROMPT_SENTINEL",
        system="SYSTEM_SENTINEL",
        principal_scope_key="f021-command",
    )

    command = captured["command"]
    assert command[0] == "/configured/openclaw"
    assert command[command.index("--agent") + 1] == "oracle"
    message = command[command.index("--message") + 1]
    assert "SYSTEM_SENTINEL" in message
    assert "PROMPT_SENTINEL" in message
    assert result.selected_model == "gpt-5"
    assert result.selected_provider == "openrouter"
    assert result.provider_invoked is True
    assert result.completion_receipt["evidence"] == {
        "provider": "openrouter",
        "model": "gpt-5",
        "identity_source": "openclaw_agent_meta",
        "command_agent": "oracle",
        "returncode": 0,
        "stdout_sha256": result.completion_receipt["evidence"]["stdout_sha256"],
        "session_id_sha256": result.completion_receipt["evidence"]["session_id_sha256"],
        "payload_count": 1,
    }
    answer = oracle._backend_answer(result, "unverified-config-label", "test")
    assert answer[1] == "gpt-5"
    assert oracle._backend_completion(answer, response=str(result))["provider_invoked"] is True


def test_openclaw_missing_or_mismatched_identity_fails_closed(monkeypatch):
    responses = [
        {"payloads": [{"text": "answer"}]},
        {
            "result": {
                "payloads": [{"text": "answer"}],
                "meta": {"agentMeta": {"model": "gpt-5", "provider": "openrouter", "agentId": "main"}},
            }
        },
    ]
    monkeypatch.setattr(oracle, "ORACLE_OPENCLAW_AGENT", "oracle")
    monkeypatch.setattr(oracle, "ORACLE_OPENCLAW_MAX_ATTEMPTS", 1)
    monkeypatch.setattr(oracle.time, "sleep", lambda _seconds: None)

    for index, payload in enumerate(responses):
        monkeypatch.setattr(
            oracle.subprocess,
            "run",
            lambda *_args, payload=payload, **_kwargs: SimpleNamespace(
                returncode=0,
                stdout=json.dumps(payload),
                stderr="",
            ),
        )
        with pytest.raises(HTTPException) as failure:
            oracle.call_openclaw_local("identity test", principal_scope_key=f"f021-invalid-{index}")
        assert failure.value.status_code == 503


def test_exact_requested_model_policy_rejects_mismatch(monkeypatch):
    monkeypatch.setattr(oracle, "_attach_l5_advanced", lambda **_kwargs: {})
    monkeypatch.setattr(oracle, "_ensure_everyday_format", lambda **kwargs: kwargs["response"])
    receipt = oracle._completion_receipt(
        kind="provider_response",
        source="openrouter:gpt-5",
        response="answer",
        evidence={
            "provider": "openrouter",
            "model": "gpt-5",
            "identity_source": "openclaw_agent_meta",
        },
    )

    auto = oracle._mk_chat_response(
        prompt="prompt",
        session_key="session",
        priority="normal",
        response="answer",
        model="gpt-5",
        done=True,
        provider_invoked=True,
        degraded=False,
        completion_receipt=receipt,
        requested_model="auto",
    )
    assert auto.done is True
    assert auto.routing_trace["model_policy"] == {
        "requested": "auto",
        "selected": "gpt-5",
        "matched": True,
    }

    with pytest.raises(HTTPException) as mismatch:
        oracle._mk_chat_response(
            prompt="prompt",
            session_key="session",
            priority="normal",
            response="answer",
            model="gpt-5",
            done=True,
            provider_invoked=True,
            degraded=False,
            completion_receipt=receipt,
            requested_model="tinyllama",
        )
    assert mismatch.value.status_code == 502


def test_singleflight_follower_timeout_empty_and_verified_result(monkeypatch):
    class Event:
        def __init__(self, signalled):
            self.signalled = signalled

        def wait(self, timeout):
            assert timeout >= 0.1
            return self.signalled

    prompt = "singleflight test"
    system = "system"
    scope = "f022-follower"
    key = oracle._sf_key(prompt, system, scope)
    monkeypatch.setattr(oracle, "ORACLE_OPENCLAW_SINGLEFLIGHT_TIMEOUT_S", 0.1)

    oracle._OPENCLAW_INFLIGHT[key] = {"event": Event(False), "result": None, "error": None}
    with pytest.raises(HTTPException) as timeout:
        oracle.call_openclaw_local(prompt, system, principal_scope_key=scope)
    assert timeout.value.status_code == 504

    oracle._OPENCLAW_INFLIGHT[key] = {"event": Event(True), "result": "", "error": None}
    with pytest.raises(HTTPException) as empty:
        oracle.call_openclaw_local(prompt, system, principal_scope_key=scope)
    assert empty.value.status_code == 503

    receipt = oracle._completion_receipt(
        kind="provider_response",
        source="openrouter:gpt-5",
        response="shared answer",
        evidence={
            "provider": "openrouter",
            "model": "gpt-5",
            "identity_source": "openclaw_agent_meta",
        },
    )
    verified = oracle._EvidenceText(
        "shared answer",
        completion_receipt=receipt,
        origin="openclaw_subprocess",
        provider_invoked=True,
        selected_model="gpt-5",
        selected_provider="openrouter",
    )
    oracle._OPENCLAW_INFLIGHT[key] = {"event": Event(True), "result": verified, "error": None}
    assert oracle.call_openclaw_local(prompt, system, principal_scope_key=scope) is verified


def test_ollama_requires_complete_exact_provider_response(monkeypatch):
    class Response:
        def __init__(self, body):
            self.body = body

        def raise_for_status(self):
            return None

        def json(self):
            return self.body

    monkeypatch.setattr(oracle.requests, "post", lambda *_args, **_kwargs: Response({}))
    with pytest.raises(HTTPException) as incomplete:
        oracle._generate_local_sync({"model": "tinyllama"}, "tinyllama")
    assert incomplete.value.status_code == 503

    monkeypatch.setattr(
        oracle.requests,
        "post",
        lambda *_args, **_kwargs: Response(
            {"response": {"text": "not a completion string"}, "model": "tinyllama", "done": True}
        ),
    )
    with pytest.raises(HTTPException) as non_string:
        oracle._generate_local_sync({"model": "tinyllama"}, "tinyllama")
    assert non_string.value.status_code == 503

    monkeypatch.setattr(
        oracle.requests,
        "post",
        lambda *_args, **_kwargs: Response({"response": "answer", "model": "other", "done": True}),
    )
    with pytest.raises(HTTPException) as mismatch:
        oracle._generate_local_sync({"model": "tinyllama"}, "tinyllama")
    assert mismatch.value.status_code == 502

    monkeypatch.setattr(
        oracle.requests,
        "post",
        lambda *_args, **_kwargs: Response({"response": "answer", "model": "tinyllama", "done": True}),
    )
    response = oracle._generate_local_sync({"model": "tinyllama"}, "tinyllama")
    assert response.done is True
    assert response.provider_invoked is True
    assert response.completion_receipt["evidence"] == {
        "provider": "ollama",
        "model": "tinyllama",
        "identity_source": "ollama_response",
    }


def test_concrete_tinyllama_request_never_enters_unrelated_provider_routing(
    monkeypatch,
    configured_memory_principal,
):
    monkeypatch.setenv("ORACLE_EMERGENCY_BYPASS", "false")
    monkeypatch.setenv("ORACLE_ROUTE_TO_AUGMENTER", "true")
    monkeypatch.setattr(oracle, "observe_passive_codec_feedback", lambda *_args, **_kwargs: {})
    monkeypatch.setattr(oracle, "_attach_l5_advanced", lambda **_kwargs: {})
    monkeypatch.setattr(oracle, "_ensure_everyday_format", lambda **kwargs: kwargs["response"])
    monkeypatch.setattr(oracle, "ensure_ollama_ready", lambda: None)
    monkeypatch.setattr(
        oracle,
        "_best_effort_answer",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("OpenClaw/bridge routing must not run")),
    )
    monkeypatch.setattr(
        oracle,
        "_should_use_augmenter",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("augmenter routing must not run")),
    )
    monkeypatch.setattr(
        oracle.subprocess,
        "run",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("OpenClaw subprocess must not run")),
    )
    captured = {}
    receipt = oracle._completion_receipt(
        kind="provider_response",
        source="ollama:tinyllama",
        response="local answer",
        evidence={
            "provider": "ollama",
            "model": "tinyllama",
            "identity_source": "ollama_response",
        },
    )

    def local_generate(payload, model):
        captured.update(payload=payload, model=model)
        return oracle.ChatResponse(
            response="local answer",
            model="tinyllama",
            done=True,
            origin="ollama_provider",
            provider_invoked=True,
            degraded=False,
            completion_receipt=receipt,
        )

    monkeypatch.setattr(oracle, "_generate_local_sync", local_generate)
    app = FastAPI()
    app.include_router(oracle.router, prefix="/oracle")
    auth = configured_memory_principal("f021-exact-tinyllama")
    response = TestClient(app).post(
        "/oracle/chat",
        json={
            "prompt": "Give one local answer.",
            "system": "SYSTEM_SENTINEL",
            "model": "tinyllama",
        },
        headers=auth.headers,
    )

    assert response.status_code == 200
    body = response.json()
    assert body["model"] == "tinyllama"
    assert body["done"] is True
    assert body["routing_trace"]["path"] == "requested_tinyllama"
    assert captured["model"] == "tinyllama"
    assert "SYSTEM_SENTINEL" in captured["payload"]["system"]


def test_bridge_preserves_receipt_bound_provider_model(monkeypatch):
    text = "A sufficiently substantive bridge answer."
    receipt = oracle._completion_receipt(
        kind="provider_response",
        source="openrouter:gpt-5",
        response=text,
        evidence={
            "provider": "openrouter",
            "model": "gpt-5",
            "identity_source": "bridge_provider_receipt",
        },
    )

    class Response:
        status_code = 200
        text = ""

        def json(self):
            return {
                "ok": True,
                "response": text,
                "model": "gpt-5",
                "provider": "openrouter",
                "done": True,
                "origin": "bridge_backend",
                "provider_invoked": True,
                "completion_receipt": receipt,
            }

    monkeypatch.setattr(oracle.requests, "post", lambda *_args, **_kwargs: Response())
    result = oracle.call_bridge("analyze this substantive bridge request")
    answer = oracle._backend_answer(result, oracle.BRIDGE_MODEL_LABEL, "bridge")
    assert result.selected_provider == "openrouter"
    assert answer[1] == "gpt-5"
    assert oracle._backend_completion(answer, response=text)["provider_invoked"] is True


def test_oracle_sandbox_status_is_never_unverified_online(monkeypatch):
    monkeypatch.setattr(oracle_sandbox, "_load_openrouter_key", lambda: "")
    unavailable = asyncio.run(oracle_sandbox.status())
    assert unavailable["status"] == "unavailable"
    assert unavailable["configured"] is False
    assert unavailable["provider_verified"] is False

    monkeypatch.setattr(oracle_sandbox, "_load_openrouter_key", lambda: "configured")
    configured = asyncio.run(oracle_sandbox.status())
    assert configured["status"] == "ready_unverified"
    assert configured["configured"] is True
    assert configured["provider_verified"] is False


def test_oracle_sandbox_maps_upstream_and_transport_failures(monkeypatch):
    monkeypatch.setattr(oracle_sandbox, "_load_openrouter_key", lambda: "configured")

    class UpstreamFailure:
        status_code = 503

    monkeypatch.setattr(oracle_sandbox.requests, "post", lambda *_args, **_kwargs: UpstreamFailure())
    with pytest.raises(HTTPException) as upstream:
        asyncio.run(oracle_sandbox.probe(oracle_sandbox.SandboxRequest(prompt="test")))
    assert upstream.value.status_code == 502

    def timeout(*_args, **_kwargs):
        raise oracle_sandbox.requests.Timeout("slow")

    monkeypatch.setattr(oracle_sandbox.requests, "post", timeout)
    with pytest.raises(HTTPException) as timed_out:
        asyncio.run(oracle_sandbox.probe(oracle_sandbox.SandboxRequest(prompt="test")))
    assert timed_out.value.status_code == 504

    def unavailable(*_args, **_kwargs):
        raise oracle_sandbox.requests.ConnectionError("down")

    monkeypatch.setattr(oracle_sandbox.requests, "post", unavailable)
    with pytest.raises(HTTPException) as transport:
        asyncio.run(oracle_sandbox.probe(oracle_sandbox.SandboxRequest(prompt="test")))
    assert transport.value.status_code == 503


def test_oracle_sandbox_rejects_malformed_success_and_normalizes_valid_completion(monkeypatch):
    monkeypatch.setattr(oracle_sandbox, "_load_openrouter_key", lambda: "configured")

    class Response:
        status_code = 200

        def __init__(self, body=None, error=None):
            self.body = body
            self.error = error

        def json(self):
            if self.error:
                raise self.error
            return self.body

    monkeypatch.setattr(
        oracle_sandbox.requests,
        "post",
        lambda *_args, **_kwargs: Response(error=ValueError("not json")),
    )
    with pytest.raises(HTTPException) as non_json:
        asyncio.run(oracle_sandbox.probe(oracle_sandbox.SandboxRequest(prompt="test")))
    assert non_json.value.status_code == 502

    monkeypatch.setattr(oracle_sandbox.requests, "post", lambda *_args, **_kwargs: Response({}))
    with pytest.raises(HTTPException) as malformed:
        asyncio.run(oracle_sandbox.probe(oracle_sandbox.SandboxRequest(prompt="test")))
    assert malformed.value.status_code == 502

    substituted = {
        "model": "openai/gpt-5-mini",
        "choices": [{"message": {"content": "provider answer"}}],
    }
    monkeypatch.setattr(
        oracle_sandbox.requests,
        "post",
        lambda *_args, **_kwargs: Response(substituted),
    )
    with pytest.raises(HTTPException) as model_mismatch:
        asyncio.run(oracle_sandbox.probe(oracle_sandbox.SandboxRequest(prompt="test")))
    assert model_mismatch.value.status_code == 502

    body = {
        "model": "openai/gpt-5",
        "choices": [{"message": {"content": "provider answer"}}],
    }
    monkeypatch.setattr(oracle_sandbox.requests, "post", lambda *_args, **_kwargs: Response(body))
    valid = asyncio.run(oracle_sandbox.probe(oracle_sandbox.SandboxRequest(prompt="test")))
    assert valid == {
        "status_code": 200,
        "ok": True,
        "model": "openai/gpt-5",
        "requested_model": "openai/gpt-5",
        "response": "provider answer",
        "body": body,
    }
