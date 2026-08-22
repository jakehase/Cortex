from __future__ import annotations

from typing import Any, Dict, Optional

from cortex_server.runtime.session_contract import CanonicalSessionEvent, normalize_session_event


JsonDict = Dict[str, Any]


_TOOL_EVENT_MAP = {
    "codex": {
        "task.started": "started",
        "task.blocked": "blocked",
        "task.retry": "retry-needed",
        "task.finished": "finished",
        "task.failed": "failed",
        "tests.started": "test-started",
        "tests.finished": "test-finished",
        "tests.failed": "test-failed",
        "handoff": "handoff-needed",
    },
    "claude-code": {
        "run.started": "started",
        "run.blocked": "blocked",
        "run.retry": "retry-needed",
        "run.finished": "finished",
        "run.failed": "failed",
        "test.started": "test-started",
        "test.finished": "test-finished",
        "test.failed": "test-failed",
        "handoff": "handoff-needed",
    },
    "tmux": {
        "session.started": "started",
        "session.stale": "stale",
        "keyword.hit": "blocked",
        "pane.blocked": "blocked",
    },
    "git": {
        "pr.opened": "pr-created",
        "pr.failed": "failed",
        "merge.blocked": "blocked",
    },
    "pytest": {
        "run.started": "test-started",
        "run.finished": "test-finished",
        "run.failed": "test-failed",
    },
    "tests": {
        "run.started": "test-started",
        "run.finished": "test-finished",
        "run.failed": "test-failed",
    },
}


def _summary_for(tool: str, event: str, payload: JsonDict) -> Optional[str]:
    for key in ("summary", "message", "reason", "title", "error"):
        text = str(payload.get(key) or "").strip()
        if text:
            return text
    if tool in {"pytest", "tests"} and event.endswith("failed"):
        return "tests failed"
    if tool == "git" and event == "pr.opened":
        pr_url = str(payload.get("url") or payload.get("pr_url") or "").strip()
        return f"pull request opened{': ' + pr_url if pr_url else ''}"
    return None


def adapt_tool_event(
    process_id: str,
    *,
    tool: str,
    event: str,
    session_id: Optional[str] = None,
    session_name: Optional[str] = None,
    payload: Optional[JsonDict] = None,
) -> CanonicalSessionEvent:
    tool_name = str(tool or "tool").strip().lower() or "tool"
    raw_event = str(event or "").strip()
    if not raw_event:
        raise ValueError("event must be non-empty")
    payload_dict = dict(payload or {})
    mapped = (_TOOL_EVENT_MAP.get(tool_name) or {}).get(raw_event, raw_event)
    summary = _summary_for(tool_name, raw_event, payload_dict)
    return normalize_session_event(
        process_id,
        mapped,
        tool=tool_name,
        session_id=session_id or str(payload_dict.get("session_id") or payload_dict.get("sessionId") or "").strip() or None,
        session_name=session_name or str(payload_dict.get("session_name") or payload_dict.get("sessionName") or "").strip() or None,
        summary=summary,
        status=str(payload_dict.get("status") or "").strip() or None,
        payload={**payload_dict, "tool_raw_event": raw_event},
    )


__all__ = ["adapt_tool_event"]
