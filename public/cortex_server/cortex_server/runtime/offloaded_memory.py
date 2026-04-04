from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Optional

from cortex_server.runtime.session_contract import CanonicalSessionEvent


JsonDict = Dict[str, object]


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _day_slug() -> str:
    return _now().strftime("%Y-%m-%d")


class RuntimeMemoryStore:
    def __init__(self, root: str | Path):
        self.root = Path(root)
        self.hot_path = self.root / "MEMORY.md"
        self.process_dir = self.root / "processes"
        self.session_dir = self.root / "sessions"
        self.daily_dir = self.root / "daily"

    def ensure_layout(self) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        self.process_dir.mkdir(parents=True, exist_ok=True)
        self.session_dir.mkdir(parents=True, exist_ok=True)
        self.daily_dir.mkdir(parents=True, exist_ok=True)
        if not self.hot_path.exists():
            self.hot_path.write_text(
                "# Runtime Memory\n\n"
                "> Non-authoritative runtime notes only.\n\n"
                "Authoritative runtime state lives in snapshots, shared state, and the process journal.\n\n"
                "Hot pointers only. Detailed runtime memory lives in:\n"
                "- processes/\n"
                "- sessions/\n"
                "- daily/\n",
                encoding="utf-8",
            )

    def _append(self, path: Path, content: str) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as handle:
            handle.write(content)

    def _process_path(self, process_id: str) -> Path:
        return self.process_dir / f"{str(process_id).strip()}.md"

    def _session_path(self, process_id: str, session_id: str) -> Path:
        return self.session_dir / f"{str(process_id).strip()}__{str(session_id).strip()}.md"

    def _daily_path(self) -> Path:
        return self.daily_dir / f"{_day_slug()}.md"

    def write_process_note(self, *, process_id: str, title: str, note: str, metadata: Optional[JsonDict] = None) -> Path:
        self.ensure_layout()
        text = (
            f"## {_now().isoformat()} {title}\n"
            "authority: non-authoritative\n"
            f"{note.strip()}\n"
        )
        if metadata:
            text += f"meta: {metadata}\n"
        text += "\n"
        path = self._process_path(process_id)
        self._append(path, text)
        self._append(self._daily_path(), f"- process {process_id}: {title} — {note.strip()}\n")
        return path

    def write_session_event(self, event: CanonicalSessionEvent) -> Path:
        self.ensure_layout()
        session_id = str(event.session_id or event.process_id).strip()
        path = self._session_path(event.process_id, session_id)
        text = (
            f"## {event.ts} {event.kind}\n"
            "authority: non-authoritative\n"
            f"tool: {event.tool or 'unknown'}\n"
            f"summary: {event.summary or event.operator_summary}\n"
            f"operator_summary: {event.operator_summary}\n"
            f"payload: {event.payload}\n\n"
        )
        self._append(path, text)
        self._append(self._daily_path(), f"- session {session_id} ({event.process_id}): {event.operator_summary}\n")
        return path


__all__ = ["RuntimeMemoryStore"]
