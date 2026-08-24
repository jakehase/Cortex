import json
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

import cortex_server.routers.oracle as oracle
from cortex_server.routers.oracle import _strict_micro_fast_answer


def test_number_only_fastpath_arithmetic():
    out = _strict_micro_fast_answer("What is 2+2? Reply number only.")
    assert out == "4"


def test_yes_no_fastpath_water_wet():
    out = _strict_micro_fast_answer("Is water wet? Reply yes/no.")
    assert out in {"yes", "no"}
    assert out == "yes"


def test_one_word_fastpath_planet():
    out = _strict_micro_fast_answer("Reply one word naming a planet.")
    assert out == "earth"


def test_openclaw_model_identity_prefers_oracle_agent_without_exposing_config(
    tmp_path, monkeypatch
):
    config = tmp_path / "openclaw.json"
    config.write_text(
        json.dumps(
            {
                "agents": {
                    "list": [
                        {
                            "id": "oracle",
                            "model": {"primary": "provider/oracle-model"},
                        }
                    ]
                },
                "credentials": {"secret": "must-not-escape"},
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.delenv("ORACLE_OPENCLAW_MODEL", raising=False)

    identity = oracle._resolve_openclaw_model_identity(config)

    assert identity == {
        "configured": True,
        "model": "provider/oracle-model",
        "source": "openclaw_config:agents.list[oracle].model",
        "error": None,
    }
    assert "must-not-escape" not in repr(identity)


def test_openclaw_executable_readiness_never_starts_the_cli(monkeypatch):
    monkeypatch.setattr(oracle.shutil, "which", lambda _value: "/opt/bin/openclaw")
    monkeypatch.setattr(oracle.os, "access", lambda *_args: True)

    def forbidden_run(*_args, **_kwargs):
        raise AssertionError("readiness must not start OpenClaw")

    monkeypatch.setattr(oracle.subprocess, "run", forbidden_run)

    readiness = oracle._openclaw_executable_readiness()

    assert readiness["available"] is True
    assert readiness["check"] == "path_lookup_only"
    assert readiness["providerCallMade"] is False


def test_assistant_rate_limit_text_is_content_and_openclaw_sessions_are_principal_scoped(monkeypatch):
    oracle._OPENCLAW_RATE_LIMITS.clear()
    oracle._OPENCLAW_INFLIGHT.clear()
    monkeypatch.setattr(oracle, "ORACLE_OPENCLAW_MAX_ATTEMPTS", 1)
    monkeypatch.setattr(oracle.time, "sleep", lambda _seconds: None)
    calls = []

    def successful_run(cmd, **_kwargs):
        calls.append(list(cmd))
        return SimpleNamespace(
            returncode=0,
            stdout=json.dumps({
                "payloads": [{"text": "rate limit reached; try again in ~9 min"}],
                "meta": {"agentMeta": {"provider": "test-provider", "model": "test-model", "agentId": oracle.ORACLE_OPENCLAW_AGENT}},
            }),
            stderr="",
        )

    monkeypatch.setattr(oracle.subprocess, "run", successful_run)
    first = oracle.call_openclaw_local("same prompt", system="same system", principal_scope_key="tenant-a-scope")
    second = oracle.call_openclaw_local("same prompt", system="same system", principal_scope_key="tenant-b-scope")

    assert first == second == "rate limit reached; try again in ~9 min"
    assert oracle._OPENCLAW_RATE_LIMITS == {}
    session_ids = [cmd[cmd.index("--session-id") + 1] for cmd in calls]
    assert len(set(session_ids)) == 2
    assert oracle._sf_key("same prompt", "same system", "tenant-a-scope") != oracle._sf_key("same prompt", "same system", "tenant-b-scope")


def test_trusted_openclaw_rate_limit_signal_only_cools_its_principal(monkeypatch):
    oracle._OPENCLAW_RATE_LIMITS.clear()
    oracle._OPENCLAW_INFLIGHT.clear()
    monkeypatch.setattr(oracle, "ORACLE_OPENCLAW_MAX_ATTEMPTS", 1)
    monkeypatch.setattr(oracle.time, "sleep", lambda _seconds: None)
    responses = iter([
        SimpleNamespace(returncode=1, stdout="", stderr="rate limit reached; try again in ~9 min"),
        SimpleNamespace(
            returncode=0,
            stdout=json.dumps({
                "payloads": [{"text": "tenant b remains available"}],
                "meta": {"agentMeta": {"provider": "test-provider", "model": "test-model", "agentId": oracle.ORACLE_OPENCLAW_AGENT}},
            }),
            stderr="",
        ),
    ])
    monkeypatch.setattr(oracle.subprocess, "run", lambda *_args, **_kwargs: next(responses))

    with pytest.raises(HTTPException):
        oracle.call_openclaw_local("prompt", principal_scope_key="tenant-a-scope")
    assert oracle._openclaw_rate_limited_active("tenant-a-scope") is True
    assert oracle._openclaw_rate_limited_active("tenant-b-scope") is False
    assert oracle.call_openclaw_local("prompt", principal_scope_key="tenant-b-scope") == "tenant b remains available"
