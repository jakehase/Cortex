"""Diplomat outbound boundary with legacy delivery held fail closed."""

from __future__ import annotations

import hashlib
import os
from datetime import datetime
from pathlib import Path
from typing import Dict, Optional

from cortex_server.modules.action_capabilities import (
    ActionAuthorization,
    assert_action_authorized,
)


def _absolute_path(value: str | Path, *, source: str) -> Path:
    path = Path(value).expanduser()
    if not path.is_absolute():
        raise ValueError(f"{source} must be an absolute path")
    return path


def _diplomat_state_root(explicit: str | Path | None = None) -> Path:
    """Resolve mutable Diplomat state outside the packaged source tree."""
    if explicit is not None:
        return _absolute_path(explicit, source="Diplomat state directory")

    configured = os.getenv("CORTEX_DIPLOMAT_STATE_DIR", "").strip()
    if configured:
        return _absolute_path(configured, source="CORTEX_DIPLOMAT_STATE_DIR")

    runtime_root = os.getenv("ORCHESTRATOR_RUNTIME_DELIVERY_ROOT", "").strip()
    if runtime_root:
        return _absolute_path(
            runtime_root,
            source="ORCHESTRATOR_RUNTIME_DELIVERY_ROOT",
        ) / "diplomat"

    artifact_root = os.getenv("CORTEX_ARTIFACT_ROOT", "").strip()
    if artifact_root:
        return _absolute_path(artifact_root, source="CORTEX_ARTIFACT_ROOT") / "diplomat"

    state_home = os.getenv("XDG_STATE_HOME", "").strip()
    if state_home:
        root = _absolute_path(state_home, source="XDG_STATE_HOME")
    else:
        root = Path.home() / ".local" / "state"
    return root / "cortex" / "diplomat"


class TheDiplomat:
    """Expose the messaging boundary without bypassing sink authorization."""

    def __init__(
        self,
        gateway_url: str = "http://localhost:8080",
        owner_number: Optional[str] = None,
        state_dir: str | Path | None = None,
    ):
        self.gateway_url = gateway_url
        self.owner_number = str(
            owner_number
            if owner_number is not None
            else os.getenv("CORTEX_DIPLOMAT_OWNER_NUMBER", "")
        ).strip()
        self.pending_requests: Dict[str, Dict] = {}
        state_root = _diplomat_state_root(state_dir)
        self.message_log = state_root / "diplomat_log.txt"
        self.pending_requests_file = state_root / "pending_requests.json"

    def send_briefing(
        self,
        message: str,
        title: str = "Cortex Update",
        *,
        authorization: Optional[ActionAuthorization] = None,
    ) -> bool:
        """Hold delivery until the final transport consumes a durable proof."""
        del message, title
        assert_action_authorized(authorization)
        return False

    def ask_permission(
        self,
        request: str,
        request_id: Optional[str] = None,
        timeout_seconds: int = 300,
        *,
        authorization: Optional[ActionAuthorization] = None,
    ) -> bool:
        """Hold the unauthenticated legacy permission-response workflow."""
        del request, request_id, timeout_seconds
        assert_action_authorized(authorization)
        return False

    def process_response(self, request_id: str, response: str) -> bool:
        """Reject responses until an authenticated inbound contract exists."""
        del request_id, response
        return False

    def _send_to_whatsapp(self, message: str) -> bool:
        """Keep the non-idempotent legacy gateway and file outbox disabled."""
        del message
        return False

    def _wait_for_response(self, request_id: str, timeout_seconds: int) -> bool:
        """Do not poll unauthenticated response state."""
        del request_id, timeout_seconds
        return False

    def _save_pending_requests(self) -> None:
        """Pending permission persistence is deliberately disabled."""
        return None

    def _load_pending_requests(self) -> None:
        """Do not revive unauthenticated legacy permission state."""
        self.pending_requests = {}

    def _log_message(self, msg_type: str, content: str, success: bool) -> None:
        """Persist and emit only fingerprints for caller-controlled fields."""
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        status = "success" if success else "failure"
        type_bytes = str(msg_type or "").encode("utf-8", errors="replace")
        content_bytes = str(content or "").encode("utf-8", errors="replace")
        type_digest = hashlib.sha256(type_bytes).hexdigest()
        content_digest = hashlib.sha256(content_bytes).hexdigest()
        log_line = (
            f"[{timestamp}] status={status} event_type_sha256={type_digest} "
            f"event_type_bytes={len(type_bytes)} content_sha256={content_digest} "
            f"content_bytes={len(content_bytes)}\n"
        )

        self.message_log.parent.mkdir(parents=True, exist_ok=True)
        flags = os.O_WRONLY | os.O_APPEND | os.O_CREAT | getattr(os, "O_CLOEXEC", 0)
        flags |= getattr(os, "O_NOFOLLOW", 0)
        descriptor = os.open(self.message_log, flags, 0o600)
        with os.fdopen(descriptor, "a", encoding="utf-8") as handle:
            handle.write(log_line)

        print(
            f"[DIPLOMAT] status={status} event_type_sha256={type_digest} "
            f"event_type_bytes={len(type_bytes)} content_sha256={content_digest} "
            f"content_bytes={len(content_bytes)}"
        )


_diplomat_instance: TheDiplomat | None = None


def get_diplomat() -> TheDiplomat:
    """Get or create the process-local Diplomat instance."""
    global _diplomat_instance
    if _diplomat_instance is None:
        _diplomat_instance = TheDiplomat()
    return _diplomat_instance
