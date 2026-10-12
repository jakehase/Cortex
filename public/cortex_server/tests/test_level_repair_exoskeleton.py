"""L17 Exoskeleton repair: byte-exact git status, no parent-repo escape, honest
status/preflight, policy denials as 4xx, read-only adapter on configured roots."""

import asyncio
import json
import shutil
import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from cortex_server.modules import exoskeleton
from cortex_server.modules.execution_capabilities import ExecutionCapabilityDenied
from cortex_server.modules.execution_engine import ExecutionBlocked
from cortex_server.modules.level_adapters import exoskeleton as exo_adapter
from cortex_server.routers import tools as tools_router
from cortex_server.tools import git_wrapper

EXECUTION_ENV = (
    "CORTEX_EXECUTION_ALLOWED_ACTIONS",
    "CORTEX_EXECUTION_ALLOWED_ROOTS",
    "CORTEX_EXECUTION_CAPABILITY_TOKEN",
)


def _run(coro):
    return asyncio.run(coro)


@pytest.fixture(autouse=True)
def _clear_env(monkeypatch):
    for name in EXECUTION_ENV:
        monkeypatch.delenv(name, raising=False)


def _git_repo(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    env = {"GIT_CONFIG_GLOBAL": "/dev/null", "GIT_CONFIG_NOSYSTEM": "1", "HOME": str(path), "PATH": "/usr/bin:/bin"}
    for cmd in (["git", "init", "-q", "."], ["git", "config", "user.email", "t@e.st"], ["git", "config", "user.name", "t"]):
        subprocess.run(cmd, cwd=path, check=True, env=env)
    (path / "tracked.py").write_text("a\n")
    (path / "b.py").write_text("b\n")
    subprocess.run(["git", "add", "."], cwd=path, check=True, env=env)
    subprocess.run(["git", "commit", "-qm", "init"], cwd=path, check=True, env=env)
    (path / "tracked.py").write_text("a\nchanged\n")
    return path


def test_porcelain_z_parsing_keeps_leading_space_and_renames():
    parsed = git_wrapper.parse_porcelain_z(" M tracked.py\0R  new.py\0old.py\0?? u.txt\0?? \x20lead.py\0")
    assert [(c.path, c.status) for c in parsed["unstaged"]] == [("tracked.py", "M")]
    assert parsed["staged"][0].path == "new.py" and parsed["staged"][0].original_path == "old.py"
    assert [c.path for c in parsed["untracked"]] == ["u.txt", " lead.py"]
    with pytest.raises(git_wrapper.GitError):
        git_wrapper.parse_porcelain_z("garbage\0")


@pytest.mark.skipif(shutil.which("git") is None, reason="git not installed")
def test_real_status_is_byte_exact_and_parent_repo_is_not_reached(tmp_path, monkeypatch):
    repo = _git_repo(tmp_path / "work" / "repo")
    status = _run(git_wrapper.GitRepo(str(repo)).status_async())
    assert [(c.path, c.status) for c in status["unstaged"]] == [("tracked.py", "M")]
    assert status["staged"] == []

    sub = repo / "sub"
    sub.mkdir()
    monkeypatch.setenv("CORTEX_EXECUTION_ALLOWED_ROOTS", str(sub))
    with pytest.raises(git_wrapper.GitError, match="authorized root"):
        git_wrapper.GitRepo(str(sub))
    monkeypatch.setenv("CORTEX_EXECUTION_ALLOWED_ROOTS", str(repo))
    assert git_wrapper.GitRepo(str(sub)).repo_root == repo.resolve()


def test_no_upward_walk_without_a_configured_root(tmp_path):
    (tmp_path / ".git").mkdir()
    (tmp_path / "child").mkdir()
    with pytest.raises(git_wrapper.GitError):
        git_wrapper.GitRepo(str(tmp_path / "child"))
    assert git_wrapper.GitRepo(str(tmp_path)).repo_root == tmp_path.resolve()


def test_exoskeleton_module_reports_measurements_not_literals():
    report = exoskeleton.get_exoskeleton().reinforce()
    assert "100%" not in json.dumps(report)
    assert set(report["binaries"]) == {"git", "docker", "ffmpeg"}
    assert report["docker_inspected"] is False


def test_status_claims_only_mounted_and_enabled_read_only_actions(monkeypatch, tmp_path):
    routes = [SimpleNamespace(path="/tools/status", methods={"GET"}),
              SimpleNamespace(path="/tools/git/status", methods={"POST"}),
              SimpleNamespace(path="/tools/git/log", methods={"POST"})]
    request = SimpleNamespace(app=SimpleNamespace(routes=routes))
    status = _run(tools_router.tools_status(request))
    assert status["capabilities"] == []  # nothing enabled by the operator
    assert status["status"] == "restricted"  # default-deny policy is not component failure
    assert all(row["capability"] != "docker_run" or row["reason"] for row in status["unavailable"])

    root = tmp_path / "exec-root"
    root.mkdir()
    monkeypatch.setenv("CORTEX_EXECUTION_ALLOWED_ACTIONS", "tools.git.status")
    monkeypatch.setenv("CORTEX_EXECUTION_ALLOWED_ROOTS", str(root))
    monkeypatch.setenv("CORTEX_EXECUTION_CAPABILITY_TOKEN", "tok")
    monkeypatch.setattr(tools_router.shutil, "which", lambda name: "/usr/bin/" + name)
    status = _run(tools_router.tools_status(request))
    assert status["capabilities"] == ["git_status"]
    assert status["status"] == "active"
    reasons = {row["capability"]: row["reason"] for row in status["unavailable"]}
    assert reasons["git_commit"] == "route_not_mounted" or "not enabled" in reasons["git_commit"]


def test_policy_denials_inside_service_are_4xx_not_500(monkeypatch, tmp_path):
    root = tmp_path / "exec-root"
    root.mkdir()
    monkeypatch.setenv("CORTEX_EXECUTION_ALLOWED_ACTIONS", "tools.git.log")
    monkeypatch.setenv("CORTEX_EXECUTION_ALLOWED_ROOTS", str(root))
    monkeypatch.setenv("CORTEX_EXECUTION_CAPABILITY_TOKEN", "tok")

    async def denied(*_a, **_k):
        raise ExecutionCapabilityDenied("execution_path_outside_roots", "outside", status_code=403)

    monkeypatch.setattr(tools_router.service, "git_log", denied)
    monkeypatch.setattr(tools_router, "extract_trace_context", lambda *a, **k: {})
    request = Request({"type": "http", "method": "GET", "path": "/tools/git/log", "query_string": b"",
                       "headers": [(b"x-cortex-execution-capability", b"tok")]})
    with pytest.raises(HTTPException) as raised:
        _run(tools_router.git_log("/etc", 5, request))
    assert raised.value.status_code == 403
    assert raised.value.detail["error"] == "execution_path_outside_roots"


def test_adapter_preflight_and_blocked_git(monkeypatch):
    out = _run(exo_adapter.run("hello there", {}))
    assert out["operation"] == "exoskeleton.preflight" and out["origin"] == "deterministic"
    assert out["data"]["repositories"] == []
    json.dumps(out)
    with pytest.raises(ExecutionBlocked) as blocked:
        _run(exo_adapter.run("any uncommitted changes in the repo?", {}))
    assert blocked.value.reason == "git_status_not_enabled_by_operator"


@pytest.mark.skipif(shutil.which("git") is None, reason="git not installed")
def test_adapter_reads_configured_root_only(monkeypatch, tmp_path):
    repo = _git_repo(tmp_path / "work" / "repo")
    monkeypatch.setenv("CORTEX_EXECUTION_ALLOWED_ACTIONS", "tools.git.status,tools.git.log")
    monkeypatch.setenv("CORTEX_EXECUTION_ALLOWED_ROOTS", str(repo))
    monkeypatch.setenv("CORTEX_EXECUTION_CAPABILITY_TOKEN", "tok")
    out = _run(exo_adapter.run("git status of /etc please", {}))
    repo_state = out["data"]["repositories"][0]
    assert repo_state["root"] == "repo"
    assert repo_state["unstaged"] == [{"path": "tracked.py", "status": "M"}]
    assert len(repo_state["head_sha"]) == 40
    assert repo_state["recent_commits"][0]["subject"] == "init"
