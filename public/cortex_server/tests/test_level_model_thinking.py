"""Level model calls pass their own reasoning level to the OpenClaw lane."""

from __future__ import annotations

import subprocess

import pytest
from fastapi import HTTPException

from cortex_server.modules import level_model
from cortex_server.routers import oracle


def _capture_call(monkeypatch):
    seen = {}

    def fake_call(prompt, system=None, **kwargs):
        seen.update(kwargs)
        raise RuntimeError("stop after capture")

    monkeypatch.setattr(oracle, "call_openclaw_local", fake_call)
    return seen


def _call():
    return level_model.level_model_call_sync(
        level=28, name="polyglot", system="s", prompt="hola", principal_scope_key="p:test",
    )


@pytest.mark.parametrize("env,expected", [(None, "medium"), ("low", "low"), ("HIGH", "high"), ("bogus", "medium")])
def test_level_calls_use_level_thinking(monkeypatch, env, expected):
    monkeypatch.delenv("CORTEX_LEVEL_MODEL_THINKING_POLYGLOT", raising=False)
    if env is None:
        monkeypatch.delenv("CORTEX_LEVEL_MODEL_THINKING", raising=False)
    else:
        monkeypatch.setenv("CORTEX_LEVEL_MODEL_THINKING", env)
    seen = _capture_call(monkeypatch)
    result = _call()
    assert result["status"] == "model_unavailable" and "text" not in result
    assert seen["thinking"] == expected
    assert seen["ephemeral_session"] is True and seen["principal_scope_key"] == "p:test"


def _capture_cmd(monkeypatch):
    seen = {}

    def fake_run(cmd, *args, **kwargs):
        seen["cmd"] = list(cmd)
        return subprocess.CompletedProcess(cmd, 1, stdout="", stderr="boom")

    monkeypatch.setattr(oracle.subprocess, "run", fake_run)
    monkeypatch.setattr(oracle, "OPENCLAW_BIN", "openclaw")
    monkeypatch.setattr(oracle, "ORACLE_OPENCLAW_AGENT", "oracle")
    monkeypatch.setattr(oracle, "ORACLE_OPENCLAW_MAX_ATTEMPTS", 1)
    monkeypatch.setattr(oracle, "ORACLE_OPENCLAW_THINKING", "high")
    return seen


@pytest.mark.parametrize("thinking,expected", [("low", "low"), (None, "high"), ("nonsense", "high")])
def test_call_openclaw_local_thinking_override(monkeypatch, thinking, expected):
    seen = _capture_cmd(monkeypatch)
    with pytest.raises(HTTPException):
        oracle.call_openclaw_local(
            f"unique prompt {thinking}", "sys", principal_scope_key="p:thinking", ephemeral_session=True,
            thinking=thinking,
        )
    cmd = seen["cmd"]
    assert cmd[cmd.index("--thinking") + 1] == expected
    assert cmd[1:3] == ["agent", "--local"]  # embedded runtime: never re-enters the gateway route gate


def test_call_openclaw_local_gateway_mode_is_opt_in(monkeypatch):
    seen = _capture_cmd(monkeypatch)
    monkeypatch.setattr(oracle, "ORACLE_OPENCLAW_LOCAL", False)
    with pytest.raises(HTTPException):
        oracle.call_openclaw_local("gateway mode prompt", "sys", principal_scope_key="p:gw", ephemeral_session=True)
    assert "--local" not in seen["cmd"]


def test_per_level_thinking_override(monkeypatch):
    monkeypatch.setenv("CORTEX_LEVEL_MODEL_THINKING", "medium")
    monkeypatch.setenv("CORTEX_LEVEL_MODEL_THINKING_POLYGLOT", "low")
    seen = _capture_call(monkeypatch)
    _call()
    assert seen["thinking"] == "low"
    assert level_model.level_model_thinking("seer") == "medium"
    assert level_model.level_model_thinking("council") == "low"  # measured per-level default
    monkeypatch.setenv("CORTEX_LEVEL_MODEL_THINKING_COUNCIL", "high")
    assert level_model.level_model_thinking("council") == "high"  # env override wins
    monkeypatch.setenv("CORTEX_LEVEL_MODEL_THINKING_POLYGLOT", "nonsense")
    assert level_model.level_model_thinking("polyglot") == "medium"
