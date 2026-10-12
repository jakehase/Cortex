"""ExecutionEngine adapter for L17 Exoskeleton: read-only tool preflight, and
read-only git status/log of operator-configured roots when the message asks
about repository state. Never uses a path from the message; never mutates."""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any, Dict, List, Mapping

from cortex_server.modules.execution_engine import ExecutionBlocked
from cortex_server.modules.level_adapters._safe_level_common import clip

LEVEL = 17
NAME = "exoskeleton"
NEEDS_MODEL = False
SAFE_AUTORUN = True  # binary/policy preflight and read-only git on configured roots only
DEFAULT_DEADLINE_S = 15.0

_REPO_INTENT = re.compile(
    r"\b(git|repo|repository|uncommitted|unstaged|staged|working tree|commits?|branch|diff|changes?)\b", re.I
)
_MAX_REPOS = 3


async def _repo_state(root: Path, token: str) -> Dict[str, Any]:
    from cortex_server.modules.execution_capabilities import (
        ExecutionCapabilityDenied,
        authorize_execution_action,
        resolve_authorized_path,
    )
    from cortex_server.tools.git_wrapper import GitError, GitRepo

    try:
        grant = authorize_execution_action("tools.git.status", token, request_path="adapter:exoskeleton")
        path = resolve_authorized_path(grant, "tools.git.status", root, require_directory=True)
        repo = GitRepo(str(path), boundary=str(root))
    except (ExecutionCapabilityDenied, GitError) as exc:
        return {"root": root.name, "error": getattr(exc, "code", None) or "not_a_repository"}
    if repo.repo_root != path:
        return {"root": root.name, "error": "root_is_not_a_repository_top_level"}
    try:
        status = await repo.status_async()
        head = await repo.head_async()
        commits: List[Dict[str, Any]] = []
        try:
            authorize_execution_action("tools.git.log", token, request_path="adapter:exoskeleton")
            commits = [
                {"sha": c.hash[:12], "subject": clip(c.message, 120), "author": c.author, "date": c.date.isoformat()}
                for c in await repo.log_async(5)
            ]
        except ExecutionCapabilityDenied:
            commits = []
    except GitError:
        return {"root": root.name, "error": "git_command_failed"}
    return {
        "root": root.name,
        "head_sha": head,
        "staged": [{"path": c.path, "status": c.status} for c in status["staged"][:50]],
        "unstaged": [{"path": c.path, "status": c.status} for c in status["unstaged"][:50]],
        "untracked": [c.path for c in status["untracked"][:50]],
        "counts": {k: len(v) for k, v in status.items()},
        "recent_commits": commits,
    }


async def run(query: str, context: Mapping[str, Any]) -> Dict[str, Any]:
    from cortex_server.modules.exoskeleton import tool_preflight
    from cortex_server.modules.execution_capabilities import configured_roots

    preflight = tool_preflight()
    data: Dict[str, Any] = {"preflight": preflight, "repositories": []}
    wants_repo = bool(_REPO_INTENT.search(str(query or "")))
    summary_parts = [
        "tools on PATH: " + (", ".join(k for k, v in preflight["binaries"].items() if v) or "none"),
        "enabled actions: " + (", ".join(preflight["enabled_actions"]) or "none"),
    ]
    if wants_repo:
        token = os.getenv("CORTEX_EXECUTION_CAPABILITY_TOKEN", "").strip()
        if "tools.git.status" not in preflight["enabled_actions"] or not token or not preflight["binaries"]["git"]:
            raise ExecutionBlocked("git_status_not_enabled_by_operator")
        roots = list(configured_roots())
        alias = str(context.get("repo_alias") or "").strip()
        if alias:
            roots = [r for r in roots if r.name == alias]
        for root in roots[:_MAX_REPOS]:
            data["repositories"].append(await _repo_state(root, token))
        for repo in data["repositories"]:
            if repo.get("error"):
                summary_parts.append(f"{repo['root']}: {repo['error']}")
            else:
                c = repo["counts"]
                summary_parts.append(
                    f"{repo['root']} @ {str(repo['head_sha'])[:12]}: {c['staged']} staged, {c['unstaged']} unstaged, "
                    f"{c['untracked']} untracked"
                    + (f"; last commit: {repo['recent_commits'][0]['subject']}" if repo["recent_commits"] else "")
                )
        if not data["repositories"]:
            summary_parts.append("no configured repository roots")
    return {
        "operation": "exoskeleton.git_status" if wants_repo else "exoskeleton.preflight",
        "origin": "deterministic",
        "summary": clip("Exoskeleton: " + " | ".join(summary_parts), 1500),
        "data": data,
    }
