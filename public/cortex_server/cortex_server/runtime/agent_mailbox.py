from __future__ import annotations

import json
import fcntl
import hashlib
import hmac
import os
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from cortex_server.runtime.durable_files import durable_mkdir, fsync_directory



def _now_iso() -> str:
    return datetime.utcnow().isoformat(timespec="milliseconds") + "Z"



def _message_id() -> str:
    return f"msg_{uuid4().hex[:16]}"


def _ack_credentials() -> Dict[str, str]:
    raw = os.getenv("CORTEX_AGENT_ACK_CREDENTIALS", "").strip()
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RuntimeError("CORTEX_AGENT_ACK_CREDENTIALS must be valid JSON") from exc
    if not isinstance(parsed, dict):
        raise RuntimeError("CORTEX_AGENT_ACK_CREDENTIALS must map agent IDs to secrets")
    credentials = {
        str(agent or "").strip(): str(secret or "").strip()
        for agent, secret in parsed.items()
    }
    if any(not agent or not secret for agent, secret in credentials.items()):
        raise RuntimeError("CORTEX_AGENT_ACK_CREDENTIALS contains an empty agent or secret")
    return credentials


def release_ack_authentication_required() -> bool:
    return os.getenv("CORTEX_ENV", "development").strip().lower() == "production" or bool(
        os.getenv("CORTEX_AGENT_ACK_CREDENTIALS", "").strip()
    )


def _acknowledgement_message(
    message: "AgentMessage",
    *,
    actor: str,
    result_receipt: Dict[str, Any],
) -> bytes:
    return json.dumps(
        {
            "version": "cortex.mailbox.ack.v1",
            "message_id": message.message_id,
            "process_id": message.process_id,
            "to_agent": message.to_agent,
            "actor": str(actor or "").strip(),
            "revision_id": message.revision_id,
            "payload": message.payload,
            "metadata": message.metadata,
            "result_receipt": dict(result_receipt or {}),
        },
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def agent_acknowledgement_signature(
    message: "AgentMessage",
    *,
    actor: str,
    result_receipt: Dict[str, Any],
    secret: str,
) -> str:
    signing_secret = str(secret or "").strip()
    if not signing_secret:
        return ""
    return hmac.new(
        signing_secret.encode("utf-8"),
        _acknowledgement_message(message, actor=actor, result_receipt=result_receipt),
        hashlib.sha256,
    ).hexdigest()


class AgentMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    message_id: str = Field(default_factory=_message_id)
    process_id: str
    from_agent: str
    to_agent: str
    kind: str = "handoff"
    payload: Dict[str, Any] = Field(default_factory=dict)
    causal_parent_ids: List[str] = Field(default_factory=list)
    handoff_id: Optional[str] = None
    revision_id: Optional[str] = None
    dedupe_key: Optional[str] = None
    created_at: str = Field(default_factory=_now_iso)
    delivery_status: str = "queued"
    attempt_count: int = 0
    last_attempt_at: Optional[str] = None
    acked_at: Optional[str] = None
    acked_by: Optional[str] = None
    ack_receipt: Optional[Dict[str, Any]] = None
    dead_lettered_at: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)

    @field_validator("message_id", "process_id", "from_agent", "to_agent", "kind", "delivery_status")
    @classmethod
    def _validate_non_empty(cls, value: str) -> str:
        value = str(value or "").strip()
        if not value:
            raise ValueError("must be non-empty")
        return value

    @field_validator("dedupe_key")
    @classmethod
    def _validate_optional_text(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        text = str(value or "").strip()
        if not text:
            raise ValueError("dedupe_key must be non-empty when provided")
        return text

    @field_validator("created_at", "last_attempt_at", "acked_at", "dead_lettered_at")
    @classmethod
    def _validate_timestamp(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        text = str(value or "").strip()
        if not text:
            raise ValueError("timestamp must be non-empty when provided")
        try:
            datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError as exc:
            raise ValueError("timestamp must be ISO-8601") from exc
        return text

    @field_validator("causal_parent_ids")
    @classmethod
    def _validate_parent_ids(cls, rows: List[str]) -> List[str]:
        cleaned = [str(row or "").strip() for row in (rows or [])]
        if any(not row for row in cleaned):
            raise ValueError("causal_parent_ids must not contain empty values")
        return cleaned

    @field_validator("attempt_count")
    @classmethod
    def _validate_attempt_count(cls, value: int) -> int:
        value = int(value or 0)
        if value < 0:
            raise ValueError("attempt_count must be non-negative")
        return value



def _model_validate_compat(data: Dict[str, Any]) -> AgentMessage:
    if hasattr(AgentMessage, "model_validate"):
        return AgentMessage.model_validate(data)
    return AgentMessage.parse_obj(data)



def _model_dump_compat(model: AgentMessage) -> Dict[str, Any]:
    if hasattr(model, "model_dump"):
        return model.model_dump()
    return model.dict()


class AgentMailbox:
    def __init__(self, path: str | Path):
        self.path = Path(path)

    @property
    def _lock_path(self) -> Path:
        return self.path.with_name(f".{self.path.name}.lock")

    @contextmanager
    def _locked(self, *, exclusive: bool):
        durable_mkdir(self.path.parent)
        with self._lock_path.open("a+b") as handle:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX if exclusive else fcntl.LOCK_SH)
            try:
                yield
            finally:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)

    @staticmethod
    def _atomic_replace(path: Path, payload: bytes) -> None:
        durable_mkdir(path.parent)
        temporary = path.with_name(f".{path.name}.{os.getpid()}.{uuid4().hex}.tmp")
        try:
            with temporary.open("xb") as handle:
                handle.write(payload)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, path)
            fsync_directory(path.parent)
        finally:
            try:
                temporary.unlink()
            except FileNotFoundError:
                pass

    def _read_envelope_unlocked(self) -> tuple[int, List[AgentMessage]]:
        if not self.path.exists():
            return 0, []
        data = json.loads(self.path.read_text(encoding="utf-8"))
        if isinstance(data, list):
            revision, raw_rows = 0, data
        elif isinstance(data, dict):
            if data.get("version") != "cortex.agent_mailbox.v2":
                raise ValueError("unsupported agent mailbox envelope")
            revision = int(data.get("persistence_revision", 0) or 0)
            raw_rows = data.get("messages")
            if revision < 0 or not isinstance(raw_rows, list):
                raise ValueError("invalid agent mailbox envelope")
        else:
            raise ValueError("agent mailbox must contain an envelope or legacy message list")
        return revision, [
            _model_validate_compat(dict(row))
            for row in raw_rows
            if isinstance(row, dict)
        ]

    def _read_all(self) -> List[AgentMessage]:
        with self._locked(exclusive=False):
            return self._read_envelope_unlocked()[1]

    def _write_all_unlocked(
        self,
        rows: List[AgentMessage],
        *,
        expected_revision: int,
    ) -> int:
        observed_revision, _ = self._read_envelope_unlocked()
        if observed_revision != expected_revision:
            raise RuntimeError(
                f"agent mailbox persistence conflict: expected {expected_revision}, observed {observed_revision}"
            )
        next_revision = observed_revision + 1
        payload = {
            "version": "cortex.agent_mailbox.v2",
            "persistence_revision": next_revision,
            "messages": [_model_dump_compat(row) for row in rows],
        }
        self._atomic_replace(
            self.path,
            (json.dumps(payload, sort_keys=True, indent=2) + "\n").encode("utf-8"),
        )
        return next_revision

    def send(self, message: Optional[AgentMessage | Dict[str, Any]] = None, **kwargs: Any) -> AgentMessage:
        if isinstance(message, AgentMessage):
            if kwargs:
                raise TypeError("cannot pass both message and keyword fields")
            record = message
        elif isinstance(message, dict):
            if kwargs:
                raise TypeError("cannot pass both message mapping and keyword fields")
            record = _model_validate_compat(message)
        else:
            record = AgentMessage(**kwargs)
        with self._locked(exclusive=True):
            revision, rows = self._read_envelope_unlocked()
            if record.dedupe_key:
                for row in rows:
                    if (
                        row.process_id == record.process_id
                        and row.from_agent == record.from_agent
                        and row.to_agent == record.to_agent
                        and row.kind == record.kind
                        and row.dedupe_key == record.dedupe_key
                        and row.delivery_status != "dead_letter"
                    ):
                        return row
            rows.append(record)
            self._write_all_unlocked(rows, expected_revision=revision)
            return record

    def list(
        self,
        *,
        process_id: Optional[str] = None,
        to_agent: Optional[str] = None,
        from_agent: Optional[str] = None,
        delivery_statuses: Optional[Sequence[str]] = None,
    ) -> List[AgentMessage]:
        with self._locked(exclusive=False):
            rows = self._read_envelope_unlocked()[1]
        allowed = {str(x).strip() for x in (delivery_statuses or []) if str(x).strip()}
        filtered: List[AgentMessage] = []
        for row in rows:
            if process_id and row.process_id != process_id:
                continue
            if to_agent and row.to_agent != to_agent:
                continue
            if from_agent and row.from_agent != from_agent:
                continue
            if allowed and row.delivery_status not in allowed:
                continue
            filtered.append(row)
        return filtered

    def receive(
        self,
        *,
        to_agent: str,
        process_id: Optional[str] = None,
        include_inflight: bool = False,
        expected_revision_id: Optional[str] = None,
        reject_stale_revision: bool = False,
    ) -> List[AgentMessage]:
        claimable_statuses = {"queued"} | ({"inflight"} if include_inflight else set())
        with self._locked(exclusive=True):
            revision, rows = self._read_envelope_unlocked()
            now = _now_iso()
            expected = str(expected_revision_id or "").strip() or None
            accepted: List[AgentMessage] = []
            changed = False
            for stored in rows:
                if process_id and stored.process_id != process_id:
                    continue
                if stored.to_agent != to_agent or stored.delivery_status not in claimable_statuses:
                    continue
                observed = str(stored.revision_id or "").strip() or None
                stale_revision = bool(expected and observed and observed != expected)
                if stale_revision:
                    stored.metadata = {
                        **dict(stored.metadata or {}),
                        "rejection_reason": "stale_revision",
                        "expected_revision_id": expected,
                        "observed_revision_id": observed,
                    }
                    if reject_stale_revision and stored.delivery_status != "dead_letter":
                        stored.delivery_status = "dead_letter"
                        stored.dead_lettered_at = now
                    changed = True
                    continue
                if stored.delivery_status == "queued":
                    stored.delivery_status = "inflight"
                    stored.attempt_count += 1
                    stored.last_attempt_at = now
                    changed = True
                accepted.append(stored)
            if changed:
                self._write_all_unlocked(rows, expected_revision=revision)
            return accepted

    def _mutate(self, message_id: str, mutate_fn) -> AgentMessage:
        with self._locked(exclusive=True):
            revision, rows = self._read_envelope_unlocked()
            for row in rows:
                if row.message_id == message_id:
                    mutate_fn(row)
                    self._write_all_unlocked(rows, expected_revision=revision)
                    return row
        raise KeyError(f"message not found: {message_id}")

    def bind_claim_payload(
        self,
        message_id: str,
        *,
        payload: Dict[str, Any],
        expected_revision_id: Optional[str] = None,
    ) -> AgentMessage:
        """Persist the exact payload a recipient will sign for acknowledgement."""

        expected = str(expected_revision_id or "").strip() or None

        def _bind(row: AgentMessage) -> None:
            if row.delivery_status != "inflight":
                raise ValueError("mailbox claim payload can only be bound while inflight")
            observed = str(row.revision_id or "").strip() or None
            if expected is not None and observed != expected:
                raise ValueError("mailbox claim payload revision changed")
            row.payload = dict(payload or {})

        return self._mutate(message_id, _bind)

    def acknowledge(
        self,
        message_id: str,
        *,
        actor: str,
        result_receipt: Optional[Dict[str, Any]] = None,
        actor_signature: Optional[str] = None,
    ) -> AgentMessage:
        now = _now_iso()
        acknowledged_by = str(actor or "").strip()

        def _acknowledge(row: AgentMessage):
            if acknowledged_by != row.to_agent:
                raise PermissionError("only the intended recipient may acknowledge a mailbox message")
            if row.delivery_status != "inflight":
                raise ValueError("mailbox message must be received before acknowledgement")
            receipt = dict(result_receipt or {})
            is_release_handoff = bool((row.metadata or {}).get("target_stage"))
            if is_release_handoff:
                expected = {
                    "candidate_ref": str((row.metadata or {}).get("candidate_ref") or ""),
                    "release_id": str((row.metadata or {}).get("release_id") or ""),
                    "revision_id": str(row.revision_id or ""),
                }
                if any(str(receipt.get(key) or "") != value for key, value in expected.items()):
                    raise ValueError("release acknowledgement receipt is not bound to the candidate and revision")
                if str(receipt.get("result") or "") not in {"approved", "rejected"}:
                    raise ValueError("release acknowledgement requires an immutable result")
                evidence = receipt.get("evidence_receipts")
                if not isinstance(evidence, list) or not evidence or any(not str(value or "").strip() for value in evidence):
                    raise ValueError("release acknowledgement requires evidence receipts")
            authentication = "development-actor-assertion"
            if is_release_handoff and release_ack_authentication_required():
                credentials = _ack_credentials()
                secret = credentials.get(acknowledged_by, "")
                expected_signature = agent_acknowledgement_signature(
                    row,
                    actor=acknowledged_by,
                    result_receipt=receipt,
                    secret=secret,
                )
                if not secret or not hmac.compare_digest(str(actor_signature or ""), expected_signature):
                    raise PermissionError("release acknowledgement requires authenticated recipient signature")
                authentication = "hmac-sha256"
            canonical = _acknowledgement_message(
                row,
                actor=acknowledged_by,
                result_receipt=receipt,
            )
            row.delivery_status = "acked"
            row.acked_at = now
            row.acked_by = acknowledged_by
            row.ack_receipt = {
                "version": "cortex.mailbox.ack.v1",
                "actor": acknowledged_by,
                "authentication": authentication,
                "bound_message_hash": hashlib.sha256(canonical).hexdigest(),
                "result_receipt": receipt,
                "acked_at": now,
            }

        return self._mutate(message_id, _acknowledge)

    def retry(self, message_id: str) -> AgentMessage:
        return self._mutate(message_id, lambda row: (setattr(row, "delivery_status", "queued"), setattr(row, "dead_lettered_at", None)))

    def recover_dead_letter(
        self,
        message_id: str,
        *,
        revision_id: Optional[str] = None,
        recovery_reason: str = "operator_requeue",
    ) -> AgentMessage:
        now = _now_iso()

        def _recover(row: AgentMessage):
            previous_metadata = dict(row.metadata or {})
            previous_count = int(previous_metadata.get("recovery_count", 0) or 0)
            row.delivery_status = "queued"
            row.dead_lettered_at = None
            row.last_attempt_at = now
            if revision_id is not None:
                row.revision_id = str(revision_id or "").strip() or None
            row.metadata = {
                **previous_metadata,
                "recovered_from_status": "dead_letter",
                "recovery_reason": str(recovery_reason or "operator_requeue").strip() or "operator_requeue",
                "recovery_count": previous_count + 1,
                "recovered_at": now,
            }

        return self._mutate(message_id, _recover)

    def dead_letter(self, message_id: str) -> AgentMessage:
        now = _now_iso()
        return self._mutate(message_id, lambda row: (setattr(row, "delivery_status", "dead_letter"), setattr(row, "dead_lettered_at", now)))


__all__ = ["AgentMailbox", "AgentMessage", "ValidationError"]
