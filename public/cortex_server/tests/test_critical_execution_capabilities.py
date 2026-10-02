from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from cortex_server.models.requests import DockerRunRequest, GitCloneRequest
from cortex_server.modules.execution_capabilities import (
    ExecutionCapabilityDenied,
    authorize_execution_action,
    configured_roots,
    require_execution_grant,
    resolve_authorized_path,
)
from cortex_server.modules.completion_truth import verified_completion_text
from cortex_server.routers import darwin, evolution, forge, geneticist, lab, tools
from cortex_server.services.tool_service import ToolService
from cortex_server.tools import docker_wrapper


EXECUTION_ENV = (
    "CORTEX_EXECUTION_ALLOWED_ACTIONS",
    "CORTEX_EXECUTION_ALLOWED_ROOTS",
    "CORTEX_EXECUTION_CAPABILITY_TOKEN",
    "CORTEX_EXECUTION_CAPABILITY_HEADER",
    "CORTEX_EXECUTION_GIT_ALLOWED_HOSTS",
)


def _clear_execution_env(monkeypatch) -> None:
    for name in EXECUTION_ENV:
        monkeypatch.delenv(name, raising=False)


def _request(path: str, token: str | None = None) -> Request:
    headers = []
    if token is not None:
        headers.append((b"x-cortex-execution-capability", token.encode("utf-8")))
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": path,
            "headers": headers,
            "query_string": b"",
            "server": ("127.0.0.1", 8000),
            "client": ("127.0.0.1", 12345),
            "scheme": "http",
        }
    )


def _configure(monkeypatch, root: Path, *actions: str, token: str = "separate-execution-secret") -> str:
    monkeypatch.setenv("CORTEX_EXECUTION_ALLOWED_ACTIONS", ",".join(actions))
    monkeypatch.setenv("CORTEX_EXECUTION_ALLOWED_ROOTS", str(root))
    monkeypatch.setenv("CORTEX_EXECUTION_CAPABILITY_TOKEN", token)
    return token


def test_host_actions_default_deny_before_tool_service_is_called(monkeypatch):
    _clear_execution_env(monkeypatch)

    called = False

    async def unexpected(*args, **kwargs):
        nonlocal called
        called = True
        raise AssertionError("tool service must not be reached")

    monkeypatch.setattr(tools.service, "git_init", unexpected)
    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(tools.git_init("/tmp/escape", _request("/tools/git/init")))

    assert exc_info.value.status_code == 503
    assert exc_info.value.detail["error"] == "execution_action_disabled"
    assert called is False


def test_action_grants_are_exact_and_require_a_separate_secret(monkeypatch, tmp_path):
    root = tmp_path / "authorized-workspaces"
    root.mkdir()
    token = _configure(monkeypatch, root, "tools.git.init")

    with pytest.raises(ExecutionCapabilityDenied) as missing:
        authorize_execution_action("tools.git.init", None)
    assert missing.value.code == "execution_capability_invalid"

    grant = authorize_execution_action("tools.git.init", token)
    require_execution_grant(grant, "tools.git.init")
    with pytest.raises(ExecutionCapabilityDenied) as mismatch:
        require_execution_grant(grant, "tools.git.commit")
    assert mismatch.value.code == "execution_grant_action_mismatch"


def test_filesystem_roots_reject_broad_roots_and_escape_paths(monkeypatch, tmp_path):
    token = _configure(monkeypatch, Path("/root/.openclaw"), "tools.git.init")
    grant = authorize_execution_action("tools.git.init", token)
    assert configured_roots() == ()
    with pytest.raises(ExecutionCapabilityDenied) as no_roots:
        resolve_authorized_path(grant, "tools.git.init", "/root/.openclaw/workspace")
    assert no_roots.value.code == "execution_roots_unconfigured"

    root = tmp_path / "authorized-workspaces"
    root.mkdir()
    _configure(monkeypatch, root, "tools.git.init", token=token)
    grant = authorize_execution_action("tools.git.init", token)
    with pytest.raises(ExecutionCapabilityDenied) as escaped:
        resolve_authorized_path(grant, "tools.git.init", root / ".." / "outside")
    assert escaped.value.code == "execution_path_outside_roots"

    monkeypatch.setenv("CORTEX_EXECUTION_ALLOWED_ROOTS", "/var/run,/run/secrets,/proc/self")
    assert configured_roots() == ()


def test_docker_host_volumes_are_checked_before_container_launch(monkeypatch, tmp_path):
    root = tmp_path / "authorized-volumes"
    root.mkdir()
    token = _configure(monkeypatch, root, "tools.docker.run")
    grant = authorize_execution_action("tools.docker.run", token)
    service = ToolService()

    launched = False

    async def unexpected_launch(config):
        nonlocal launched
        launched = True
        raise AssertionError("container launch must not be reached")

    monkeypatch.setattr(service.docker.containers, "run", unexpected_launch)
    payload = DockerRunRequest(image="python:3.12", volumes={"/etc": "/host"})
    with pytest.raises(ExecutionCapabilityDenied) as denied:
        asyncio.run(service.docker_run(payload, grant=grant))
    assert denied.value.code == "execution_path_outside_roots"
    assert launched is False


def test_docker_wrapper_forces_non_networked_read_only_container(monkeypatch):
    commands = []

    async def fake_run(args, timeout=None, capture=True):
        commands.append(args)
        return "container-id\n"

    async def fake_inspect(container_id):
        return docker_wrapper.Container(
            id=container_id,
            name="safe",
            image="python:3.12",
            status="running",
        )

    manager = docker_wrapper.ContainerManager()
    monkeypatch.setattr(docker_wrapper, "_run_cmd", fake_run)
    monkeypatch.setattr(manager, "inspect", fake_inspect)
    config = docker_wrapper.ContainerConfig(image="python:3.12", detach=True)
    asyncio.run(manager.run(config))

    command = commands[0]
    assert "--pull=never" in command
    assert "com.cortex.execution.managed=true" in command
    assert "--network=none" in command
    assert "--read-only" in command
    assert "--cap-drop=ALL" in command
    assert "--security-opt=no-new-privileges" in command


def test_docker_stop_requires_immutable_cortex_ownership_label(monkeypatch):
    commands = []

    async def fake_run(args, timeout=None, capture=True):
        commands.append(args)
        if args[:2] == ["docker", "inspect"]:
            return json.dumps([{"Id": "a" * 64, "Config": {"Labels": {}, "Env": ["SAFE=value"]}, "State": {}}])
        raise AssertionError("unowned container reached docker stop")

    monkeypatch.setattr(docker_wrapper, "_run_cmd", fake_run)
    with pytest.raises(docker_wrapper.DockerError, match="not owned"):
        asyncio.run(docker_wrapper.ContainerManager().stop("a" * 12))
    assert len(commands) == 1


def test_docker_build_and_evolution_registry_data_cannot_restore_egress_or_traversal(monkeypatch):
    commands = []

    async def fake_run(args, timeout=None, capture=True):
        commands.append(args)
        return "built\n"

    monkeypatch.setattr(docker_wrapper, "_run_cmd", fake_run)
    asyncio.run(
        docker_wrapper.ImageManager().build(
            path="/authorized/context",
            tag="safe-image",
            dockerfile="/authorized/context/Dockerfile",
        )
    )
    assert "--network=none" in commands[0]
    assert "--pull=false" in commands[0]

    root = Path("/tmp") / "unused-docker-build-policy-root"
    token = _configure(monkeypatch, root, "tools.docker.build")
    with pytest.raises(ExecutionCapabilityDenied) as unavailable:
        authorize_execution_action("tools.docker.build", token)
    assert unavailable.value.code == "execution_isolation_unavailable"

    with pytest.raises(HTTPException) as traversal:
        evolution._safe_skill_module_name("../../routers/escape")
    assert traversal.value.detail["error"] == "invalid_skill_module_name"


@pytest.mark.parametrize("action", ["tools.docker.pull", "tools.docker.logs"])
def test_unallowlisted_docker_egress_and_unowned_logs_stay_degraded(monkeypatch, tmp_path, action):
    root = tmp_path / "docker-policy"
    root.mkdir()
    token = _configure(monkeypatch, root, action)

    with pytest.raises(ExecutionCapabilityDenied) as unavailable:
        authorize_execution_action(action, token)
    assert unavailable.value.code == "execution_isolation_unavailable"


def test_ffmpeg_stays_degraded_without_an_os_isolated_worker(monkeypatch, tmp_path):
    root = tmp_path / "media"
    root.mkdir()
    token = _configure(monkeypatch, root, "tools.ffmpeg.convert")

    with pytest.raises(ExecutionCapabilityDenied) as unavailable:
        authorize_execution_action("tools.ffmpeg.convert", token)
    assert unavailable.value.code == "execution_isolation_unavailable"


def test_model_mutation_rejects_receiptless_or_response_mismatched_completion():
    assert verified_completion_text({"done": True, "response": "generated code"}) == ""
    assert verified_completion_text({
        "done": True,
        "response": "generated code",
        "completion_receipt": {
            "version": "cortex.oracle.completion.v1",
            "receipt_id": "forged",
            "kind": "provider_response",
            "source": "provider",
            "completed_at": "2026-08-21T00:00:00+00:00",
            "response_sha256": "0" * 64,
        },
    }) == ""


def test_git_clone_rejects_non_https_and_unlisted_egress_before_launch(monkeypatch, tmp_path):
    root = tmp_path / "repositories"
    root.mkdir()
    token = _configure(monkeypatch, root, "tools.git.clone")
    grant = authorize_execution_action("tools.git.clone", token)
    service = ToolService()
    launched = False

    async def unexpected_clone(*args, **kwargs):
        nonlocal launched
        launched = True
        raise AssertionError("Git subprocess must not be reached")

    monkeypatch.setattr("cortex_server.services.tool_service.GitRepo.clone_async", unexpected_clone)
    payload = GitCloneRequest(repo_url="ext::sh -c id", destination=str(root / "repo"))
    with pytest.raises(ExecutionCapabilityDenied) as denied:
        asyncio.run(service.git_clone(payload, grant=grant))
    assert denied.value.code == "execution_git_remote_denied"
    assert launched is False

    for unsafe_repo_action in ("tools.git.add", "tools.git.pull"):
        monkeypatch.setenv("CORTEX_EXECUTION_ALLOWED_ACTIONS", unsafe_repo_action)
        with pytest.raises(ExecutionCapabilityDenied) as unavailable:
            authorize_execution_action(unsafe_repo_action, token)
        assert unavailable.value.code == "execution_isolation_unavailable"


def test_lab_never_runs_caller_python_without_an_os_sandbox(monkeypatch):
    launched = False

    async def unexpected_launch(*args, **kwargs):
        nonlocal launched
        launched = True
        raise AssertionError("subprocess must not be reached")

    monkeypatch.setattr(lab.asyncio, "create_subprocess_exec", unexpected_launch)
    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(lab._run_python("print('unsafe')"))
    assert exc_info.value.status_code == 503
    assert exc_info.value.detail["error"] == "lab_execution_unavailable"
    assert launched is False


def test_darwin_auto_approve_cannot_write_generated_code(monkeypatch, tmp_path):
    root = tmp_path / "darwin-workspace"
    root.mkdir()
    target = root / "module.py"
    original = "VALUE = 1\n"
    target.write_text(original, encoding="utf-8")
    token = _configure(monkeypatch, root, "darwin.evolve")

    async def generated(*args, **kwargs):
        return "VALUE = 2\n"

    monkeypatch.setattr(darwin, "consult_oracle", generated)
    result = asyncio.run(
        darwin.darwin_evolve(
            darwin.EvolveRequest(target_file=str(target), issue="change value", auto_approve=True),
            _request("/darwin/evolve", token),
        )
    )
    assert result.status == "pending_approval"
    assert result.approval_required is True
    assert target.read_text(encoding="utf-8") == original


def test_geneticist_apply_blocks_malformed_required_preflight(monkeypatch, tmp_path):
    root = tmp_path / "geneticist-workspace"
    root.mkdir()
    target = root / "module.py"
    original = "VALUE = 1\n"
    target.write_text(original, encoding="utf-8")
    token = _configure(monkeypatch, root, "geneticist.apply")
    proposal_id = "critical-preflight-regression"
    geneticist._PROPOSALS[proposal_id] = {
        "strategy": "mutate",
        "target_path": str(target),
        "new_code": "VALUE = 2\n",
        "diff": "synthetic",
    }

    async def malformed_gate():
        return {"success": True}

    monkeypatch.setattr(geneticist, "_sentinel_apply_gate", malformed_gate)
    try:
        result = asyncio.run(
            geneticist.apply_proposal(
                geneticist.ApplyRequest(proposal_id=proposal_id, confirm=True, force=True),
                _request("/geneticist/apply", token),
            )
        )
    finally:
        geneticist._PROPOSALS.pop(proposal_id, None)

    assert result["success"] is False
    assert result["blocked"] is True
    assert result["error"] == "sentinel_gate_unavailable"
    assert target.read_text(encoding="utf-8") == original


def test_model_generated_filesystem_workflows_default_deny(monkeypatch):
    _clear_execution_env(monkeypatch)
    request = _request("/forge/propose")
    with pytest.raises(HTTPException) as forge_denied:
        asyncio.run(
            forge.propose_router(
                forge.ProposeRequest(level_number=40, level_name="Denied", description="no write"),
                request,
            )
        )
    assert forge_denied.value.detail["error"] == "execution_action_disabled"

    with pytest.raises(HTTPException) as evolution_denied:
        asyncio.run(
            evolution.materialize_skill(
                evolution.MaterializeRequest(skill_id="latest"),
                _request("/evolution/materialize"),
            )
        )
    assert evolution_denied.value.detail["error"] == "execution_action_disabled"
