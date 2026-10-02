"""Chronos scheduler with the legacy autonomous night shift held fail closed."""

from __future__ import annotations

import asyncio
import hashlib
import os
import threading
import weakref
from datetime import datetime
from pathlib import Path

from cortex_server.modules.action_capabilities import (
    ActionAuthorization,
    assert_action_authorized,
)


def _state_root() -> Path:
    configured = os.getenv("CORTEX_CHRONOS_STATE_DIR", "").strip()
    if configured:
        root = Path(configured).expanduser()
    elif os.getenv("CORTEX_ARTIFACT_ROOT", "").strip():
        root = Path(os.environ["CORTEX_ARTIFACT_ROOT"]).expanduser() / "chronos"
    elif os.getenv("XDG_STATE_HOME", "").strip():
        root = Path(os.environ["XDG_STATE_HOME"]).expanduser() / "cortex" / "chronos"
    else:
        root = Path.home() / ".local" / "state" / "cortex" / "chronos"
    if not root.is_absolute():
        raise ValueError("Chronos state directory must be absolute")
    return root


class Chronos:
    """Schedule the night-shift boundary without minting sink authority.

    The former pipeline generated source, mutated persona state, and sent
    messages after one coarse scheduler decision.  Those sinks cannot safely
    share a capability, so the pipeline remains unavailable until each final
    sink has its own target- and payload-bound delegation.
    """

    def __init__(self, changelog_path: str | None = None):
        configured_changelog = changelog_path or os.getenv(
            "CORTEX_CHRONOS_CHANGELOG_PATH",
            str(_state_root() / "changelog.txt"),
        )
        self.changelog_path = Path(configured_changelog).expanduser()
        if not self.changelog_path.is_absolute():
            raise ValueError("Chronos changelog path must be absolute")
        self.running = False
        self.last_run_date: str | None = None

    async def start_scheduler(self) -> None:
        """Start the async scheduler loop."""
        if self.running:
            return
        self.running = True
        self._log("Chronos started")
        try:
            while self.running:
                now = datetime.now()
                current_time = now.strftime("%H:%M")
                current_date = now.strftime("%Y-%m-%d")
                if current_time == "03:00" and self.last_run_date != current_date:
                    self.last_run_date = current_date
                    authorization = self._scheduled_authorization(current_date)
                    if authorization is None:
                        self._log("Night shift held without delegated capabilities")
                    else:
                        await self.run_night_shift(authorization=authorization)
                await asyncio.sleep(60)
        finally:
            self.running = False

    def _scheduled_authorization(
        self, current_date: str
    ) -> ActionAuthorization | None:
        """Never synthesize authority from scheduler time or local state."""
        del current_date
        return None

    async def run_night_shift(
        self,
        *,
        authorization: ActionAuthorization | None = None,
    ) -> None:
        """Reject the legacy multi-sink pipeline even with a coarse receipt."""
        assert_action_authorized(authorization)
        raise RuntimeError(
            "Chronos night shift is disabled until every final sink consumes "
            "a target- and payload-bound delegated capability"
        )

    def _log(self, message: str) -> None:
        """Persist and emit only an event digest and byte count."""
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        message_bytes = str(message or "").encode("utf-8", errors="replace")
        message_digest = hashlib.sha256(message_bytes).hexdigest()
        log_line = (
            f"[{timestamp}] event_sha256={message_digest} "
            f"event_bytes={len(message_bytes)}\n"
        )

        self.changelog_path.parent.mkdir(parents=True, exist_ok=True)
        flags = os.O_WRONLY | os.O_APPEND | os.O_CREAT | getattr(os, "O_CLOEXEC", 0)
        flags |= getattr(os, "O_NOFOLLOW", 0)
        descriptor = os.open(self.changelog_path, flags, 0o600)
        with os.fdopen(descriptor, "a", encoding="utf-8") as handle:
            handle.write(log_line)

        print(
            f"[CHRONOS] event_sha256={message_digest} "
            f"event_bytes={len(message_bytes)}"
        )

    def stop(self) -> None:
        """Stop the scheduler."""
        was_running = self.running
        self.running = False
        if was_running:
            self._log("Chronos stopped")


_chronos_instance: Chronos | None = None
_chronos_instances: weakref.WeakKeyDictionary = weakref.WeakKeyDictionary()
_chronos_lock = threading.Lock()


def get_chronos() -> Chronos:
    """Get or create the Chronos instance for the running event loop."""
    global _chronos_instance
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        if _chronos_instance is None:
            _chronos_instance = Chronos()
        return _chronos_instance
    with _chronos_lock:
        instance = _chronos_instances.get(loop)
        if instance is None:
            instance = Chronos()
            _chronos_instances[loop] = instance
        return instance
