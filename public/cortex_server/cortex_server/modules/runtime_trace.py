from __future__ import annotations

import json
import subprocess
from typing import Any, Dict, List, Optional, Sequence

from fastapi import Request

from cortex_server.modules.evidence_governance import capability_matrix
from cortex_server.modules.reasoning_scheduler import record_process_event


JsonDict = Dict[str, Any]


TRACE_HEADER_MAP = {
    "process_id": "x-cortex-process-id",
    "agent_id": "x-cortex-agent-id",
    "scope": "x-cortex-scope",
    "objective_key": "x-cortex-objective-key",
    "session_key": "x-cortex-session-key",
    "repo_path": "x-cortex-repo-path",
    "tool_name": "x-cortex-tool-name",
}


def _clean_text(value: Any, *, limit: int = 800) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, str):
        text = value
    elif isinstance(value, (dict, list, tuple)):
        try:
            text = json.dumps(value, sort_keys=True)
        except Exception:
            text = str(value)
    else:
        text = str(value)
    text = text.replace("\x00", "")
    if len(text) <= limit:
        return text
    return text[: max(1, limit - 1)] + "…"


def _clean_rows(value: Any, *, limit: int = 12, row_limit: int = 400) -> List[str]:
    text = str(value or "")
    rows = []
    for row in text.splitlines():
        cleaned = _clean_text(row, limit=row_limit)
        if cleaned:
            rows.append(cleaned)
        if len(rows) >= max(1, int(limit or 12)):
            break
    return rows


def extract_trace_context(request: Optional[Request] = None, *, defaults: Optional[JsonDict] = None) -> JsonDict:
    context = dict(defaults or {})
    if request is not None:
        headers = request.headers
        for key, header_name in TRACE_HEADER_MAP.items():
            if not context.get(key):
                value = str(headers.get(header_name) or "").strip()
                if value:
                    context[key] = value
        if not context.get("scope"):
            scope = str(request.query_params.get("scope") or "").strip()
            if scope:
                context["scope"] = scope
        if not context.get("agent_id"):
            agent_id = str(request.query_params.get("agent_id") or "").strip()
            if agent_id:
                context["agent_id"] = agent_id
        if not context.get("process_id"):
            process_id = str(request.query_params.get("process_id") or "").strip()
            if process_id:
                context["process_id"] = process_id
        context.setdefault("path", str(request.url.path or "").strip() or None)
        context.setdefault("method", str(request.method or "").strip() or None)
    return {key: value for key, value in context.items() if value is not None and str(value).strip()}


def _base_payload(context: Optional[JsonDict] = None, payload: Optional[JsonDict] = None) -> JsonDict:
    out: JsonDict = {}
    for key in ("agent_id", "scope", "objective_key", "session_key", "repo_path", "tool_name", "path", "method"):
        value = (context or {}).get(key)
        if value is not None and str(value).strip():
            out[key] = value
    out.update(dict(payload or {}))
    return out


def record_trace_event(context: Optional[JsonDict], kind: str, payload: Optional[JsonDict] = None) -> None:
    process_id = str((context or {}).get("process_id") or "").strip()
    if not process_id:
        return
    controls = capability_matrix()
    layer = next((row for row in (controls.get("layers") or []) if row.get("layer") == "event_capture"), {})
    if not bool(layer.get("enabled", True)):
        return
    try:
        merged = _base_payload(context, payload)
        merged.setdefault("source_subsystem", str((context or {}).get("tool_name") or kind).split(".")[0])
        merged.setdefault("visibility", "operator_safe")
        merged.setdefault("presentation_policy", "operator_safe")
        merged.setdefault("storage_policy", "store_redacted")
        record_process_event(process_id, kind, merged)
    except Exception:
        return


def shell_preview(result: Any) -> JsonDict:
    stdout = getattr(result, "stdout", None)
    stderr = getattr(result, "stderr", None)
    return {
        "success": bool(getattr(result, "success", False)) if hasattr(result, "success") else None,
        "returncode": getattr(result, "returncode", None),
        "stdout_preview": _clean_text(stdout),
        "stderr_preview": _clean_text(stderr),
        "stdout_lines": _clean_rows(stdout),
        "stderr_lines": _clean_rows(stderr),
    }


def emit_output_events(context: Optional[JsonDict], *, stdout: Optional[str] = None, stderr: Optional[str] = None, prefix: str = "command") -> None:
    for row in _clean_rows(stdout, limit=20, row_limit=500):
        record_trace_event(context, f"{prefix}_stdout", {"chunk": row})
    for row in _clean_rows(stderr, limit=20, row_limit=500):
        record_trace_event(context, f"{prefix}_stderr", {"chunk": row})


def _run_git(repo_path: str, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(["git", "-C", repo_path, *args], capture_output=True, text=True, check=False)


def git_status_snapshot(repo_path: Optional[str]) -> Optional[JsonDict]:
    target = str(repo_path or "").strip()
    if not target:
        return None
    try:
        short = _run_git(target, "status", "--short")
        branch = _run_git(target, "rev-parse", "--abbrev-ref", "HEAD")
        return {
            "repo_path": target,
            "branch": _clean_text(branch.stdout.strip(), limit=120),
            "status_lines": _clean_rows(short.stdout, limit=40, row_limit=220),
            "status_preview": _clean_text(short.stdout, limit=1200),
            "stderr_preview": _clean_text(short.stderr, limit=400),
        }
    except Exception:
        return None


def git_diff_snapshot(repo_path: Optional[str], *, cached: bool = False) -> Optional[JsonDict]:
    target = str(repo_path or "").strip()
    if not target:
        return None
    try:
        args: List[str] = ["diff", "--stat"]
        if cached:
            args.insert(1, "--cached")
        diff = _run_git(target, *args)
        patch_args: List[str] = ["diff", "--unified=0"]
        if cached:
            patch_args.insert(1, "--cached")
        patch = _run_git(target, *patch_args)
        return {
            "repo_path": target,
            "cached": bool(cached),
            "stat_lines": _clean_rows(diff.stdout, limit=30, row_limit=240),
            "stat_preview": _clean_text(diff.stdout, limit=1000),
            "patch_preview": _clean_text(patch.stdout, limit=1600),
            "stderr_preview": _clean_text(diff.stderr or patch.stderr, limit=400),
        }
    except Exception:
        return None


async def git_status_snapshot_async(repo_path: Optional[str]) -> Optional[JsonDict]:
    target = str(repo_path or "").strip()
    if not target:
        return None
    try:
        from cortex_server.tools.git_wrapper import run_git_async
        short = await run_git_async(["git", "-C", target, "status", "--short"])
        branch = await run_git_async(["git", "-C", target, "rev-parse", "--abbrev-ref", "HEAD"])
        return {"repo_path": target, "branch": _clean_text(branch.stdout.strip(), limit=120),
                "status_lines": _clean_rows(short.stdout, limit=40, row_limit=220),
                "status_preview": _clean_text(short.stdout, limit=1200),
                "stderr_preview": _clean_text(short.stderr, limit=400)}
    except Exception:
        return None


async def git_diff_snapshot_async(repo_path: Optional[str], *, cached: bool = False) -> Optional[JsonDict]:
    target = str(repo_path or "").strip()
    if not target:
        return None
    try:
        from cortex_server.tools.git_wrapper import run_git_async
        args = ["diff", "--cached", "--stat"] if cached else ["diff", "--stat"]
        patch_args = ["diff", "--cached", "--unified=0"] if cached else ["diff", "--unified=0"]
        diff = await run_git_async(["git", "-C", target, *args])
        patch = await run_git_async(["git", "-C", target, *patch_args])
        return {"repo_path": target, "cached": bool(cached),
                "stat_lines": _clean_rows(diff.stdout, limit=30, row_limit=240),
                "stat_preview": _clean_text(diff.stdout, limit=1000),
                "patch_preview": _clean_text(patch.stdout, limit=1600),
                "stderr_preview": _clean_text(diff.stderr or patch.stderr, limit=400)}
    except Exception:
        return None


def classify_command(argv: Sequence[str]) -> str:
    rows = [str(row or "").strip() for row in (argv or []) if str(row or "").strip()]
    joined = " ".join(rows).lower()
    if not rows:
        return "command"
    if any(token in joined for token in ("pytest", "unittest", "nose", "tox")):
        return "test"
    if rows[0] == "git":
        return "git"
    if rows[0].endswith("python") or rows[0].endswith("python3"):
        return "python"
    return rows[0]


__all__ = [
    "classify_command",
    "emit_output_events",
    "extract_trace_context",
    "git_diff_snapshot",
    "git_diff_snapshot_async",
    "git_status_snapshot",
    "git_status_snapshot_async",
    "record_trace_event",
    "shell_preview",
]
