from __future__ import annotations

import asyncio
import fcntl
import hashlib
import hmac
import json
import math
import os
import re
import stat
import threading
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Sequence
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from cortex_server.runtime.agent_mailbox import AgentMailbox, AgentMessage, release_ack_authentication_required
from cortex_server.runtime.agent_supervisor import AgentLease, AgentSupervisor
from cortex_server.runtime.durable_files import durable_mkdir, fsync_directory
from cortex_server.runtime.handoff_contract import HandoffArtifactRef, HandoffContract, HandoffEvidenceRef
from cortex_server.runtime.process_event import ProcessEvent
from cortex_server.runtime.process_journal import ProcessJournal
from cortex_server.runtime.process_snapshot import ProcessSnapshot, ProcessSnapshotStore
from cortex_server.runtime.runtime_delivery_quota import (
    MAX_RUNTIME_DELIVERY_OBJECT_BYTES,
    assert_process_count,
    assert_runtime_delivery_capacity,
    assert_runtime_delivery_volume_capacity,
    read_recoverable_jsonl,
    runtime_delivery_quota_transaction,
    runtime_delivery_recovery_transaction,
)
from cortex_server.runtime.session_registry import SessionRecord
from cortex_server.runtime.shared_process_state import SharedProcessState, SharedProcessStateStore


JsonDict = Dict[str, Any]


RELEASE_STAGE_TOPOLOGY = ("draft", "build_verified", "canary_verified", "production")

DEFAULT_RELEASE_ARTIFACT_MAX_BYTES = 4 * 1024 * 1024
DEFAULT_RELEASE_ARTIFACT_RELEASE_QUOTA_BYTES = 64 * 1024 * 1024
DEFAULT_RELEASE_ARTIFACT_STORE_QUOTA_BYTES = 1024 * 1024 * 1024
DEFAULT_RELEASE_ARTIFACT_ORPHAN_GRACE_SECONDS = 3600
MAX_RELEASE_ARTIFACT_RECEIPTS = 128
MAX_RELEASE_ARTIFACT_CLAIMS_BYTES = 64 * 1024
MAX_RELEASE_VERIFIER_CLOCK_SKEW_SECONDS = 5 * 60
MAX_RELEASE_ROLLBACK_IDEMPOTENCY_RESULTS = 64
MAX_RELEASE_LOCK_STRIPES = 64
MAX_RELEASE_RECEIPT_METADATA_BYTES = 2 * 1024 * 1024
MAX_RELEASE_STATE_BYTES = 4 * 1024 * 1024
MAX_RELEASE_HISTORY_BYTES = 64 * 1024 * 1024
MAX_RELEASE_PROCESS_DURABLE_BYTES = 128 * 1024 * 1024
MAX_RELEASE_GLOBAL_DURABLE_BYTES = 1536 * 1024 * 1024
# A history frame contains one bounded state plus bounded intent provenance and
# a small integrity/audit envelope.  Ordinary growth must leave one complete
# frame, stage, and save intent available to an already-durable rollback.
MAX_RELEASE_HISTORY_FRAME_BYTES = 2 * MAX_RUNTIME_DELIVERY_OBJECT_BYTES + 64 * 1024
RELEASE_HISTORY_RECOVERY_RESERVE_BYTES = MAX_RELEASE_HISTORY_FRAME_BYTES
RELEASE_PROCESS_RECOVERY_RESERVE_BYTES = (
    MAX_RELEASE_HISTORY_FRAME_BYTES
    + MAX_RELEASE_STATE_BYTES
    + MAX_RUNTIME_DELIVERY_OBJECT_BYTES
)
RELEASE_GLOBAL_RECOVERY_RESERVE_BYTES = RELEASE_PROCESS_RECOVERY_RESERVE_BYTES

_RELEASE_OPAQUE_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
_LEGACY_RELEASE_LOCK_RE = re.compile(r"^\..+\.json\.rollback\.lock$")
_PRODUCTION_IMAGE_DIGEST_RE = re.compile(r"^sha256:[0-9a-f]{64}$")
_IMMUTABLE_PRODUCTION_IMAGE_REF_RE = re.compile(
    r"^[a-z0-9][a-z0-9._:/-]{0,446}@sha256:[0-9a-f]{64}$"
)


def release_opaque_identifier(value: str, *, field: str) -> str:
    """Return a path-safe, bounded identifier used by release boundaries."""

    normalized = str(value or "").strip()
    if not _RELEASE_OPAQUE_ID_RE.fullmatch(normalized):
        raise ValueError(f"{field} must be a bounded opaque identifier")
    return normalized


def normalize_production_image_binding(
    *,
    image_ref: str,
    image_digest: str,
) -> tuple[str, str]:
    """Validate one published OCI image reference and its immutable digest."""

    normalized_ref = str(image_ref or "").strip()
    normalized_digest = str(image_digest or "").strip()
    if not _PRODUCTION_IMAGE_DIGEST_RE.fullmatch(normalized_digest):
        raise ValueError("production image_digest must be a lowercase SHA-256 digest")
    if not _IMMUTABLE_PRODUCTION_IMAGE_REF_RE.fullmatch(normalized_ref):
        raise ValueError("production image_ref must be an immutable OCI reference")
    if not hmac.compare_digest(normalized_ref.rsplit("@", 1)[-1], normalized_digest):
        raise ValueError("production image_ref and image_digest do not match")
    return normalized_ref, normalized_digest


def production_image_binding_from_claims(claims: Dict[str, Any]) -> tuple[str, str]:
    return normalize_production_image_binding(
        image_ref=str((claims or {}).get("image_ref") or ""),
        image_digest=str((claims or {}).get("image_digest") or ""),
    )


def production_image_binding_from_state(
    state: "ReleaseWorkflowState",
) -> tuple[str, str]:
    metadata = dict(state.metadata or {})
    return normalize_production_image_binding(
        image_ref=str(metadata.get("production_image_ref") or ""),
        image_digest=str(metadata.get("production_image_digest") or ""),
    )


def operator_rollback_command(image_ref: str, image_digest: str) -> str:
    normalized_ref, _ = normalize_production_image_binding(
        image_ref=image_ref,
        image_digest=image_digest,
    )
    services = "cortex-brain release-verifier release-manager"
    return (
        f"CORTEX_IMAGE_REF={normalized_ref} docker compose pull {services} && "
        f"CORTEX_IMAGE_REF={normalized_ref} docker compose up -d --no-build --pull never {services}"
    )


@dataclass(frozen=True)
class ReleaseArtifactStorageLimits:
    max_artifact_bytes: int
    release_quota_bytes: int
    store_quota_bytes: int
    orphan_grace_seconds: int


def _artifact_limit_from_env(name: str, default: int, *, allow_zero: bool = False) -> int:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    if not raw.isdecimal():
        raise RuntimeError(f"{name} must be {'a non-negative' if allow_zero else 'a positive'} integer")
    value = int(raw)
    if value < 0 or (value == 0 and not allow_zero):
        raise RuntimeError(f"{name} must be {'a non-negative' if allow_zero else 'a positive'} integer")
    return value


def release_artifact_storage_limits() -> ReleaseArtifactStorageLimits:
    limits = ReleaseArtifactStorageLimits(
        max_artifact_bytes=min(DEFAULT_RELEASE_ARTIFACT_MAX_BYTES, _artifact_limit_from_env(
            "CORTEX_RELEASE_ARTIFACT_MAX_BYTES",
            DEFAULT_RELEASE_ARTIFACT_MAX_BYTES,
        )),
        release_quota_bytes=min(DEFAULT_RELEASE_ARTIFACT_RELEASE_QUOTA_BYTES, _artifact_limit_from_env(
            "CORTEX_RELEASE_ARTIFACT_RELEASE_QUOTA_BYTES",
            DEFAULT_RELEASE_ARTIFACT_RELEASE_QUOTA_BYTES,
        )),
        store_quota_bytes=min(DEFAULT_RELEASE_ARTIFACT_STORE_QUOTA_BYTES, _artifact_limit_from_env(
            "CORTEX_RELEASE_ARTIFACT_STORE_QUOTA_BYTES",
            DEFAULT_RELEASE_ARTIFACT_STORE_QUOTA_BYTES,
        )),
        orphan_grace_seconds=min(DEFAULT_RELEASE_ARTIFACT_ORPHAN_GRACE_SECONDS, _artifact_limit_from_env(
            "CORTEX_RELEASE_ARTIFACT_ORPHAN_GRACE_SECONDS",
            DEFAULT_RELEASE_ARTIFACT_ORPHAN_GRACE_SECONDS,
            allow_zero=True,
        )),
    )
    if limits.max_artifact_bytes > limits.release_quota_bytes:
        raise RuntimeError("release artifact maximum must not exceed the per-release quota")
    if limits.release_quota_bytes > limits.store_quota_bytes:
        raise RuntimeError("release artifact per-release quota must not exceed the store quota")
    return limits


class ReleaseCanaryPolicy(BaseModel):
    """Immutable server-owned observations required for a release promotion."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    policy_id: str
    target_stage: str
    minimum_traffic: int
    minimum_observation_seconds: int
    minimum_availability: float
    maximum_error_rate: float
    rollback_error_rate: float


_RELEASE_CANARY_POLICIES = (
    ReleaseCanaryPolicy(
        policy_id="cortex.release.canary-verified.v1",
        target_stage="canary_verified",
        minimum_traffic=1000,
        minimum_observation_seconds=900,
        minimum_availability=0.99,
        maximum_error_rate=0.01,
        rollback_error_rate=0.02,
    ),
    ReleaseCanaryPolicy(
        policy_id="cortex.release.production.v1",
        target_stage="production",
        minimum_traffic=1000,
        minimum_observation_seconds=900,
        minimum_availability=0.99,
        maximum_error_rate=0.01,
        rollback_error_rate=0.02,
    ),
)


def _release_canary_policy(target_stage: str) -> Optional[ReleaseCanaryPolicy]:
    target = str(target_stage or "").strip()
    return next((policy for policy in _RELEASE_CANARY_POLICIES if policy.target_stage == target), None)


def release_canary_policy(target_stage: str) -> JsonDict:
    """Return a copy of the immutable policy that evidence must echo exactly."""

    policy = _release_canary_policy(target_stage)
    if policy is None:
        raise KeyError(f"release canary policy not configured for stage: {target_stage}")
    return {
        "policy_id": policy.policy_id,
        "target_stage": policy.target_stage,
        "thresholds": {
            "minimum_traffic": policy.minimum_traffic,
            "minimum_observation_seconds": policy.minimum_observation_seconds,
            "minimum_availability": policy.minimum_availability,
            "maximum_error_rate": policy.maximum_error_rate,
            "rollback_error_rate": policy.rollback_error_rate,
        },
    }


def _atomic_write_json(path: Path, payload: Dict[str, Any]) -> None:
    durable_mkdir(path.parent)
    encoded = (json.dumps(payload, sort_keys=True, indent=2) + "\n").encode("utf-8")
    temporary = path.with_name(f".{path.name}.{os.getpid()}.{uuid4().hex}.tmp")
    try:
        with temporary.open("xb") as handle:
            handle.write(encoded)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        fsync_directory(path.parent)
    finally:
        if temporary.exists():
            temporary.unlink()


def _append_fsynced_jsonl(path: Path, payload: Dict[str, Any]) -> None:
    durable_mkdir(path.parent)
    if path.exists():
        raw = path.read_bytes()
        offset = 0
        incomplete_offset: Optional[int] = None
        for line in raw.splitlines(keepends=True):
            if not line.endswith(b"\n"):
                incomplete_offset = offset
                break
            try:
                decoded = json.loads(line)
            except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                raise ValueError("release history contains an invalid complete frame") from exc
            if not isinstance(decoded, dict):
                raise ValueError("release history frame must be an object")
            offset += len(line)
        if incomplete_offset is not None:
            with path.open("r+b") as handle:
                handle.truncate(incomplete_offset)
                handle.flush()
                os.fsync(handle.fileno())
            fsync_directory(path.parent)
    encoded = (json.dumps(payload, sort_keys=True) + "\n").encode("utf-8")
    with path.open("ab") as handle:
        handle.write(encoded)
        handle.flush()
        os.fsync(handle.fileno())
    fsync_directory(path.parent)



def _now() -> datetime:
    return datetime.now(timezone.utc)



def _now_iso() -> str:
    return _now().isoformat(timespec="milliseconds").replace("+00:00", "Z")



def _release_id() -> str:
    return f"rel_{uuid4().hex[:16]}"



def _fencepost_id() -> str:
    return f"fence_{uuid4().hex[:16]}"



def _history_id() -> str:
    return f"relhist_{uuid4().hex[:16]}"



def _dedupe_rows(rows: Sequence[str]) -> List[str]:
    out: List[str] = []
    for row in rows or []:
        text = str(row or "").strip()
        if text and text not in out:
            out.append(text)
    return out



def _parse_ts(value: Optional[str]) -> Optional[datetime]:
    text = str(value or "").strip()
    if not text:
        return None
    return datetime.fromisoformat(text.replace("Z", "+00:00"))


def _release_verifier_credentials() -> Dict[str, str]:
    raw = os.getenv("CORTEX_RELEASE_VERIFIER_CREDENTIALS", "").strip()
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RuntimeError("CORTEX_RELEASE_VERIFIER_CREDENTIALS must be valid JSON") from exc
    if not isinstance(parsed, dict):
        raise RuntimeError("CORTEX_RELEASE_VERIFIER_CREDENTIALS must map verifier IDs to secrets")
    credentials = {
        str(verifier or "").strip(): str(secret or "").strip()
        for verifier, secret in parsed.items()
    }
    if any(not verifier or not secret for verifier, secret in credentials.items()):
        raise RuntimeError("CORTEX_RELEASE_VERIFIER_CREDENTIALS contains an empty verifier or secret")
    return credentials


def _artifact_payload_bytes(payload: Any) -> bytes:
    if isinstance(payload, bytes):
        return payload
    if isinstance(payload, bytearray):
        return bytes(payload)
    if isinstance(payload, str):
        return payload.encode("utf-8")
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def canonical_release_artifact_bytes(payload: Any) -> bytes:
    """Return the exact bounded representation covered by an artifact digest."""

    return _artifact_payload_bytes(payload)


def prepare_release_artifact(
    payload: Any,
    *,
    max_bytes: Optional[int] = None,
) -> tuple[bytes, str]:
    effective_max = (
        release_artifact_storage_limits().max_artifact_bytes
        if max_bytes is None
        else int(max_bytes)
    )
    if effective_max <= 0:
        raise ValueError("release artifact maximum must be positive")
    encoded = canonical_release_artifact_bytes(payload)
    if len(encoded) > effective_max:
        raise ValueError(f"release artifact exceeds maximum size of {effective_max} bytes")
    return encoded, f"sha256:{hashlib.sha256(encoded).hexdigest()}"


_ARTIFACT_STORE_LOCKS_GUARD = threading.Lock()
_ARTIFACT_STORE_LOCKS: Dict[str, threading.RLock] = {}
_RELEASE_METADATA_LOCKS_GUARD = threading.Lock()
_RELEASE_METADATA_LOCKS: Dict[str, threading.RLock] = {}


class ReleaseArtifactStore:
    """Content-addressed immutable release outputs used by signed attestations."""

    def __init__(self, path: str | Path, *, delivery_root: Optional[str | Path] = None):
        self.path = Path(path)
        self.delivery_root = Path(delivery_root) if delivery_root is not None else self.path.parent

    def _target(self, content_hash: str) -> Path:
        digest = str(content_hash or "").removeprefix("sha256:")
        if len(digest) != 64 or any(ch not in "0123456789abcdef" for ch in digest):
            raise ValueError("content_hash must be a lowercase SHA-256 digest")
        return self.path / digest[:2] / f"{digest}.artifact"

    def _lock_target(self) -> Path:
        return self.path.parent / f".{self.path.name}.publication.lock"

    @contextmanager
    def publication_transaction(self):
        """Serialize quota admission, publication, and receipt persistence."""

        lock_key = str(self.path.resolve())
        with _ARTIFACT_STORE_LOCKS_GUARD:
            thread_lock = _ARTIFACT_STORE_LOCKS.setdefault(lock_key, threading.RLock())
        with thread_lock:
            lock_target = self._lock_target()
            durable_mkdir(lock_target.parent)
            with lock_target.open("a+b") as handle:
                fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
                try:
                    yield
                finally:
                    fcntl.flock(handle.fileno(), fcntl.LOCK_UN)

    def _artifact_targets(self) -> List[Path]:
        if not self.path.exists():
            return []
        return sorted(self.path.glob("*/*.artifact"))

    def storage_usage_bytes(self) -> int:
        return sum(target.stat().st_size for target in self._artifact_targets())

    def release_usage_bytes(self, artifact_refs: Sequence[str]) -> int:
        total = 0
        for artifact_ref in _dedupe_rows(artifact_refs):
            target = self._target(artifact_ref)
            if not target.exists():
                raise FileNotFoundError(f"immutable release artifact not found: {artifact_ref}")
            total += target.stat().st_size
        return total

    def assert_release_capacity(
        self,
        artifact_refs: Sequence[str],
        *,
        content_hash: str,
        encoded_size: int,
        release_quota_bytes: int,
    ) -> None:
        references = set(_dedupe_rows(artifact_refs))
        usage = self.release_usage_bytes(sorted(references))
        additional = 0 if content_hash in references else int(encoded_size)
        if usage + additional > int(release_quota_bytes):
            raise ValueError(
                f"release artifact quota exceeded: {usage + additional} > {int(release_quota_bytes)} bytes"
            )

    def publish_prepared(
        self,
        encoded: bytes,
        content_hash: str,
        *,
        store_quota_bytes: int,
    ) -> tuple[str, str, bool]:
        actual_hash = f"sha256:{hashlib.sha256(encoded).hexdigest()}"
        if not hmac.compare_digest(actual_hash, str(content_hash or "")):
            raise ValueError("prepared release artifact hash does not match its content")
        target = self._target(content_hash)
        with runtime_delivery_quota_transaction(self.delivery_root):
            if target.exists():
                if target.read_bytes() != encoded:
                    raise ValueError("immutable artifact digest collision")
                return content_hash, content_hash, False
            projected_usage = self.storage_usage_bytes() + len(encoded)
            if projected_usage > int(store_quota_bytes):
                raise ValueError(
                    f"release artifact store quota exceeded: {projected_usage} > {int(store_quota_bytes)} bytes"
                )
            assert_runtime_delivery_volume_capacity(
                self.delivery_root,
                additional_bytes=len(encoded),
            )
            durable_mkdir(target.parent)
            temporary = target.with_name(f".{target.name}.{os.getpid()}.{uuid4().hex}.tmp")
            try:
                with temporary.open("xb") as handle:
                    handle.write(encoded)
                    handle.flush()
                    os.fsync(handle.fileno())
                os.replace(temporary, target)
                fsync_directory(target.parent)
            finally:
                if temporary.exists():
                    temporary.unlink()
        return content_hash, content_hash, True

    def put(self, payload: Any) -> tuple[str, str]:
        limits = release_artifact_storage_limits()
        encoded, content_hash = prepare_release_artifact(
            payload,
            max_bytes=limits.max_artifact_bytes,
        )
        with self.publication_transaction():
            artifact_ref, content_hash, _created = self.publish_prepared(
                encoded,
                content_hash,
                store_quota_bytes=limits.store_quota_bytes,
            )
        return artifact_ref, content_hash

    @staticmethod
    def _old_enough(target: Path, *, grace_seconds: int) -> bool:
        return (_now().timestamp() - target.stat().st_mtime) >= int(grace_seconds)

    def _unlink_target(self, target: Path) -> None:
        parent = target.parent
        target.unlink()
        fsync_directory(parent)
        try:
            parent.rmdir()
        except OSError:
            return
        if self.path.exists():
            fsync_directory(self.path)

    def prune_orphans(
        self,
        referenced_artifact_refs: Sequence[str],
        *,
        grace_seconds: int,
    ) -> List[str]:
        """Remove aged unpublished temporaries and unreferenced artifacts."""

        if not self.path.exists():
            return []
        referenced = set(_dedupe_rows(referenced_artifact_refs))
        removed: List[str] = []
        candidates = list(self.path.glob("*/.*.tmp"))
        candidates.extend(self._artifact_targets())
        for target in candidates:
            if not target.exists() or not self._old_enough(target, grace_seconds=grace_seconds):
                continue
            if target.suffix == ".artifact":
                artifact_ref = f"sha256:{target.stem}"
                if artifact_ref in referenced:
                    continue
                removed.append(artifact_ref)
            else:
                removed.append(target.name)
            self._unlink_target(target)
        return removed

    def remove_publication(self, artifact_ref: str) -> None:
        target = self._target(artifact_ref)
        if not target.exists():
            return
        self._unlink_target(target)

    def resolve(self, artifact_ref: str) -> bytes:
        target = self._target(artifact_ref)
        if not target.exists():
            raise FileNotFoundError(f"immutable release artifact not found: {artifact_ref}")
        encoded = target.read_bytes()
        actual = f"sha256:{hashlib.sha256(encoded).hexdigest()}"
        if not hmac.compare_digest(actual, str(artifact_ref or "")):
            raise ValueError("immutable release artifact failed content hash verification")
        return encoded


def _artifact_attestation_payload(receipt: Dict[str, Any]) -> bytes:
    return json.dumps(
        {
            "version": "cortex.release-artifact-attestation.v1",
            "artifact_id": receipt.get("artifact_id"),
            "artifact_ref": receipt.get("artifact_ref"),
            "content_hash": receipt.get("content_hash"),
            "artifact_kind": receipt.get("artifact_kind"),
            "target_stage": receipt.get("target_stage"),
            "candidate_ref": receipt.get("candidate_ref"),
            "release_id": receipt.get("release_id"),
            "revision_id": receipt.get("revision_id"),
            "producer": receipt.get("producer"),
            "verifier": receipt.get("verifier"),
            "validation_outcome": receipt.get("validation_outcome"),
            "claims": dict(receipt.get("claims") or {}),
            "created_at": receipt.get("created_at"),
        },
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def release_artifact_attestation_signature(receipt: Dict[str, Any], *, secret: str) -> str:
    signing_secret = str(secret or "").strip()
    if not signing_secret:
        return ""
    return hmac.new(signing_secret.encode("utf-8"), _artifact_attestation_payload(receipt), hashlib.sha256).hexdigest()


def _is_bound_release_approval(
    message: AgentMessage,
    state: "ReleaseWorkflowState",
    *,
    target_stage: str,
    valid_receipts: Dict[str, "ReleaseArtifactReceipt"],
    required_artifact_hashes: Sequence[str],
    required_image_ref: str,
    required_image_digest: str,
) -> bool:
    if message.delivery_status != "acked" or message.acked_by != message.to_agent:
        return False
    ack = message.ack_receipt or {}
    result = ack.get("result_receipt") if isinstance(ack, dict) else None
    if not isinstance(result, dict) or result.get("result") != "approved":
        return False
    if release_ack_authentication_required() and ack.get("authentication") != "hmac-sha256":
        return False
    evidence = result.get("evidence_receipts")
    bindings_valid = bool(
        ack.get("actor") == message.to_agent
        and result.get("candidate_ref") == state.candidate_ref
        and result.get("release_id") == state.release_id
        and result.get("revision_id") == state.revision_id
        and isinstance(evidence, list)
        and evidence
    )
    if not bindings_valid:
        return False
    resolved_receipts: List[ReleaseArtifactReceipt] = []
    for evidence_id in _dedupe_rows([str(row) for row in evidence]):
        receipt = valid_receipts.get(evidence_id)
        if receipt is None:
            return False
        resolved_receipts.append(receipt)
    return any(
        _canary_evidence_satisfies_stage(
            receipt,
            target_stage=target_stage,
            required_artifact_hashes=required_artifact_hashes,
            required_image_ref=required_image_ref,
            required_image_digest=required_image_digest,
        )
        for receipt in resolved_receipts
    )


class ReleaseRollbackFencepost(BaseModel):
    model_config = ConfigDict(extra="forbid")

    fencepost_id: str = Field(default_factory=_fencepost_id)
    process_id: str
    stage: str
    revision_id: str
    snapshot_id: str
    shared_state_revision_id: str
    image_ref: Optional[str] = Field(
        default=None,
        pattern=r"^[a-z0-9][a-z0-9._:/-]{0,446}@sha256:[0-9a-f]{64}$",
    )
    image_digest: Optional[str] = Field(
        default=None,
        pattern=r"^sha256:[0-9a-f]{64}$",
    )
    last_event_id: Optional[str] = None
    lifecycle_state: str
    created_at: str = Field(default_factory=_now_iso)
    restore_state: Dict[str, Any] = Field(default_factory=dict)
    metadata: Dict[str, Any] = Field(default_factory=dict)

    @field_validator(
        "fencepost_id",
        "process_id",
        "stage",
        "revision_id",
        "snapshot_id",
        "shared_state_revision_id",
        "lifecycle_state",
    )
    @classmethod
    def _validate_non_empty(cls, value: str) -> str:
        value = str(value or "").strip()
        if not value:
            raise ValueError("must be non-empty")
        return value

    @field_validator("process_id")
    @classmethod
    def _validate_process_id(cls, value: str) -> str:
        return release_opaque_identifier(value, field="process_id")

    @field_validator("created_at")
    @classmethod
    def _validate_timestamp(cls, value: str) -> str:
        text = str(value or "").strip()
        if not text:
            raise ValueError("created_at must be non-empty")
        try:
            datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError as exc:
            raise ValueError("created_at must be ISO-8601") from exc
        return text


class ReleaseWorkflowState(BaseModel):
    model_config = ConfigDict(extra="forbid")

    release_id: str = Field(default_factory=_release_id)
    process_id: str
    candidate_ref: str
    target_environment: str
    revision_id: str
    current_stage: str = "draft"
    status: str = "preparing"
    persistence_revision: int = 0
    updated_at: str = Field(default_factory=_now_iso)
    workflow_id: Optional[str] = None
    promotion_history: List[Dict[str, Any]] = Field(default_factory=list)
    handoff_records: List[Dict[str, Any]] = Field(default_factory=list)
    rollback_fenceposts: List[ReleaseRollbackFencepost] = Field(default_factory=list)
    operator_holds: List[str] = Field(default_factory=list)
    safe_push_criteria: Dict[str, Any] = Field(default_factory=dict)
    metadata: Dict[str, Any] = Field(default_factory=dict)

    @field_validator("release_id", "process_id", "candidate_ref", "target_environment", "revision_id", "current_stage", "status")
    @classmethod
    def _validate_non_empty(cls, value: str) -> str:
        value = str(value or "").strip()
        if not value:
            raise ValueError("must be non-empty")
        return value

    @field_validator("process_id")
    @classmethod
    def _validate_process_id(cls, value: str) -> str:
        return release_opaque_identifier(value, field="process_id")

    @field_validator("updated_at")
    @classmethod
    def _validate_timestamp(cls, value: str) -> str:
        text = str(value or "").strip()
        if not text:
            raise ValueError("updated_at must be non-empty")
        try:
            datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError as exc:
            raise ValueError("updated_at must be ISO-8601") from exc
        return text

    @field_validator("operator_holds")
    @classmethod
    def _validate_operator_holds(cls, rows: List[str]) -> List[str]:
        cleaned = [str(row or "").strip() for row in (rows or [])]
        if any(not row for row in cleaned):
            raise ValueError("operator_holds must not contain empty values")
        return cleaned

    @field_validator("persistence_revision")
    @classmethod
    def _validate_persistence_revision(cls, value: int) -> int:
        revision = int(value or 0)
        if revision < 0:
            raise ValueError("persistence_revision must be non-negative")
        return revision


class ReleaseArtifactReceipt(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    artifact_id: str
    artifact_ref: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    content_hash: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    artifact_kind: str
    target_stage: Optional[str] = None
    candidate_ref: str
    release_id: str
    revision_id: str
    producer: str
    verifier: str
    validation_outcome: str
    claims: Dict[str, Any] = Field(default_factory=dict)
    created_at: str = Field(default_factory=_now_iso)
    acceptance_epoch: Optional[float] = None
    attestation_signature: str = Field(pattern=r"^[0-9a-f]{64}$")

    @field_validator("artifact_id", "artifact_kind", "candidate_ref", "release_id", "revision_id", "producer", "verifier")
    @classmethod
    def _receipt_non_empty(cls, value: str) -> str:
        text = str(value or "").strip()
        if not text:
            raise ValueError("artifact receipt fields must be non-empty")
        return text

    @field_validator("validation_outcome")
    @classmethod
    def _receipt_outcome(cls, value: str) -> str:
        outcome = str(value or "").strip().lower()
        if outcome not in {"passed", "failed"}:
            raise ValueError("validation_outcome must be passed or failed")
        return outcome

    @field_validator("target_stage")
    @classmethod
    def _receipt_target_stage(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        text = str(value or "").strip()
        if not text:
            raise ValueError("target_stage must be non-empty when provided")
        return text

    @field_validator("created_at")
    @classmethod
    def _receipt_timestamp(cls, value: str) -> str:
        _parse_ts(value)
        return value

    @field_validator("acceptance_epoch", mode="before")
    @classmethod
    def _receipt_acceptance_epoch(cls, value: Any) -> Optional[float]:
        if value is None:
            return None
        if (
            isinstance(value, bool)
            or not isinstance(value, (int, float))
            or not math.isfinite(float(value))
            or float(value) < 0
        ):
            raise ValueError("acceptance_epoch must be a finite non-negative server epoch")
        return float(value)

    @field_validator("claims")
    @classmethod
    def _bounded_receipt_claims(cls, value: Dict[str, Any]) -> Dict[str, Any]:
        encoded = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
        if len(encoded) > MAX_RELEASE_ARTIFACT_CLAIMS_BYTES:
            raise ValueError(
                f"release artifact claims exceed {MAX_RELEASE_ARTIFACT_CLAIMS_BYTES} bytes"
            )
        return value


def create_release_artifact_receipt(
    state: ReleaseWorkflowState,
    *,
    artifact_store: ReleaseArtifactStore,
    artifact_id: str,
    payload: Any,
    artifact_kind: str,
    producer: str,
    verifier: str,
    verifier_secret: str,
    validation_outcome: str = "passed",
    target_stage: Optional[str] = None,
    claims: Optional[Dict[str, Any]] = None,
    created_at: Optional[str] = None,
) -> ReleaseArtifactReceipt:
    artifact_ref, content_hash = artifact_store.put(payload)
    unsigned = {
        "artifact_id": str(artifact_id or "").strip(),
        "artifact_ref": artifact_ref,
        "content_hash": content_hash,
        "artifact_kind": str(artifact_kind or "").strip(),
        "target_stage": str(target_stage or "").strip() or None,
        "candidate_ref": state.candidate_ref,
        "release_id": state.release_id,
        "revision_id": state.revision_id,
        "producer": str(producer or "").strip(),
        "verifier": str(verifier or "").strip(),
        "validation_outcome": str(validation_outcome or "").strip(),
        "claims": dict(claims or {}),
        "created_at": str(created_at or _now_iso()),
    }
    return ReleaseArtifactReceipt.model_validate(
        {
            **unsigned,
            "attestation_signature": release_artifact_attestation_signature(unsigned, secret=verifier_secret),
        }
    )


def verify_release_artifact_receipt(
    receipt: ReleaseArtifactReceipt,
    *,
    artifact_store: ReleaseArtifactStore,
    verifier_credentials: Optional[Dict[str, Any]] = None,
    require_current_verifier: bool = False,
) -> None:
    _verify_release_artifact_authorization(
        receipt,
        verifier_credentials=verifier_credentials,
        require_current_verifier=require_current_verifier,
    )
    encoded = artifact_store.resolve(receipt.artifact_ref)
    verify_release_artifact_receipt_payload(
        receipt,
        encoded=encoded,
        verifier_credentials=verifier_credentials,
        require_current_verifier=require_current_verifier,
    )


def _verify_release_artifact_authorization(
    receipt: ReleaseArtifactReceipt,
    *,
    verifier_credentials: Optional[Dict[str, Any]] = None,
    require_current_verifier: bool = False,
) -> None:
    if receipt.producer == receipt.verifier:
        raise PermissionError("release artifact producer cannot self-verify")
    receipt_time = _parse_ts(receipt.created_at)
    if receipt_time is None or receipt_time.tzinfo is None:
        raise PermissionError("release artifact receipt time must be timezone-aware")
    receipt_epoch = receipt_time.astimezone(timezone.utc).timestamp()
    acceptance_epoch = receipt.acceptance_epoch
    if (
        acceptance_epoch is not None
        and abs(receipt_epoch - acceptance_epoch)
        > MAX_RELEASE_VERIFIER_CLOCK_SKEW_SECONDS
    ):
        raise PermissionError("release artifact verifier clock skew exceeds the server bound")
    credentials = dict(verifier_credentials) if verifier_credentials is not None else _release_verifier_credentials()
    raw_credential = credentials.get(receipt.verifier)
    if isinstance(raw_credential, dict):
        secret = str(raw_credential.get("secret") or "").strip()
        activation_epoch = raw_credential.get("activation_epoch")
        retirement_epoch = raw_credential.get("retirement_epoch")
        if (
            isinstance(activation_epoch, bool)
            or not isinstance(activation_epoch, (int, float))
            or not math.isfinite(float(activation_epoch))
            or float(activation_epoch) < 0
            or isinstance(retirement_epoch, bool)
            or (
                retirement_epoch is not None
                and (
                    not isinstance(retirement_epoch, (int, float))
                    or not math.isfinite(float(retirement_epoch))
                    or float(retirement_epoch) < float(activation_epoch)
                )
            )
        ):
            raise PermissionError(
                f"release artifact verifier lifecycle is invalid: {receipt.verifier}"
            )
        if acceptance_epoch is None:
            raise PermissionError(
                "release artifact receipt is missing its server acceptance epoch"
            )
        # Lifecycle membership is permanently bound to server admission.  The
        # signed verifier timestamp remains immutable evidence metadata and is
        # used only for the bounded skew check above.
        lifecycle_epoch = float(acceptance_epoch)
        if lifecycle_epoch < float(activation_epoch) or (
            retirement_epoch is not None
            and lifecycle_epoch >= float(retirement_epoch)
        ):
            raise PermissionError(
                f"release artifact receipt is outside verifier lifecycle: {receipt.verifier}"
            )
        if require_current_verifier and retirement_epoch is not None:
            raise PermissionError(
                f"retired release artifact verifier cannot authorize new evidence: {receipt.verifier}"
            )
    else:
        secret = str(raw_credential or "").strip()
    if not secret:
        raise PermissionError(f"release artifact verifier is not authorized: {receipt.verifier}")
    expected_signature = release_artifact_attestation_signature(receipt.model_dump(), secret=secret)
    if not hmac.compare_digest(receipt.attestation_signature, expected_signature):
        raise PermissionError("release artifact attestation signature is invalid")


def verify_release_artifact_receipt_payload(
    receipt: ReleaseArtifactReceipt,
    *,
    encoded: bytes,
    verifier_credentials: Optional[Dict[str, Any]] = None,
    require_current_verifier: bool = False,
) -> None:
    """Verify identity, HMAC, digest, and claims without publishing content."""

    _verify_release_artifact_authorization(
        receipt,
        verifier_credentials=verifier_credentials,
        require_current_verifier=require_current_verifier,
    )
    actual_hash = f"sha256:{hashlib.sha256(encoded).hexdigest()}"
    if not hmac.compare_digest(receipt.artifact_ref, actual_hash):
        raise ValueError("release artifact receipt reference does not match artifact content")
    if not hmac.compare_digest(receipt.content_hash, actual_hash):
        raise ValueError("release artifact receipt content hash does not match immutable artifact")
    if (
        receipt.artifact_kind == "release_bundle"
        and receipt.artifact_id.startswith("artifact_release_bundle:")
    ):
        production_image_binding_from_claims(receipt.claims)
    if receipt.artifact_kind == "canary_evidence":
        try:
            artifact_claims = json.loads(encoded.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ValueError("canary evidence artifact must be canonical JSON") from exc
        if artifact_claims != receipt.claims or encoded != _artifact_payload_bytes(receipt.claims):
            raise ValueError("canary evidence claims do not match immutable artifact content")
        policy = _release_canary_policy(str(receipt.target_stage or ""))
        if policy is None:
            raise ValueError(f"canary evidence target has no server release policy: {receipt.target_stage}")
        if not _canary_claims_have_strict_schema(receipt.claims):
            raise ValueError("canary evidence does not match the strict server evidence schema")
        if not _canary_evidence_echoes_policy(receipt.claims, policy=policy):
            raise ValueError("canary evidence does not echo the immutable server release policy")
        if receipt.validation_outcome == "passed" and not _canary_observations_satisfy_policy(
            receipt.claims,
            policy=policy,
        ):
            raise ValueError("passed canary evidence does not satisfy the immutable server release policy")


def _canary_evidence_echoes_policy(claims: Dict[str, Any], *, policy: ReleaseCanaryPolicy) -> bool:
    thresholds = claims.get("thresholds") if isinstance(claims.get("thresholds"), dict) else {}
    expected = release_canary_policy(policy.target_stage)
    return bool(
        str(claims.get("policy_id") or "").strip() == policy.policy_id
        and thresholds == expected["thresholds"]
    )


def _canary_claims_have_strict_schema(claims: Dict[str, Any]) -> bool:
    if not isinstance(claims, dict) or set(claims) != {
        "policy_id",
        "deployment_id",
        "cohort_id",
        "image_ref",
        "image_digest",
        "traffic_volume",
        "observation_window_seconds",
        "artifact_hashes",
        "metrics",
        "thresholds",
    }:
        return False
    if type(claims.get("traffic_volume")) is not int or type(claims.get("observation_window_seconds")) is not int:
        return False
    if claims["traffic_volume"] < 0 or claims["observation_window_seconds"] < 0:
        return False
    if not all(isinstance(claims.get(field), str) and 0 < len(claims[field]) <= 512 for field in ("policy_id", "deployment_id", "cohort_id")):
        return False
    try:
        production_image_binding_from_claims(claims)
    except ValueError:
        return False
    hashes = claims.get("artifact_hashes")
    if not isinstance(hashes, list) or len(hashes) > 256 or not all(isinstance(row, str) and 0 < len(row) <= 256 for row in hashes):
        return False
    metrics = claims.get("metrics")
    if not isinstance(metrics, dict) or set(metrics) != {"availability", "error_rate"}:
        return False
    for value in metrics.values():
        if type(value) not in {int, float} or not math.isfinite(float(value)):
            return False
        if not 0.0 <= float(value) <= 1.0:
            return False
    thresholds = claims.get("thresholds")
    if not isinstance(thresholds, dict) or set(thresholds) != {
        "minimum_traffic",
        "minimum_observation_seconds",
        "minimum_availability",
        "maximum_error_rate",
        "rollback_error_rate",
    }:
        return False
    if type(thresholds["minimum_traffic"]) is not int or type(thresholds["minimum_observation_seconds"]) is not int:
        return False
    for field in ("minimum_availability", "maximum_error_rate", "rollback_error_rate"):
        value = thresholds[field]
        if type(value) not in {int, float} or not math.isfinite(float(value)):
            return False
    return True


def _canary_observations_satisfy_policy(claims: Dict[str, Any], *, policy: ReleaseCanaryPolicy) -> bool:
    if not _canary_claims_have_strict_schema(claims):
        return False
    metrics = claims.get("metrics") if isinstance(claims.get("metrics"), dict) else {}
    traffic_volume = claims["traffic_volume"]
    observation_window = claims["observation_window_seconds"]
    availability = float(metrics["availability"])
    error_rate = float(metrics["error_rate"])
    return bool(
        math.isfinite(availability)
        and math.isfinite(error_rate)
        and traffic_volume >= policy.minimum_traffic
        and observation_window >= policy.minimum_observation_seconds
        and 0.0 <= availability <= 1.0
        and 0.0 <= error_rate <= 1.0
        and availability >= policy.minimum_availability
        and error_rate <= policy.maximum_error_rate
        and error_rate < policy.rollback_error_rate
    )


def _canary_evidence_satisfies_stage(
    receipt: ReleaseArtifactReceipt,
    *,
    target_stage: str,
    required_artifact_hashes: Sequence[str],
    required_image_ref: str,
    required_image_digest: str,
) -> bool:
    if receipt.artifact_kind != "canary_evidence" or receipt.target_stage != target_stage:
        return False
    claims = dict(receipt.claims or {})
    policy = _release_canary_policy(target_stage)
    if policy is None or not _canary_evidence_echoes_policy(claims, policy=policy):
        return False
    deployment_id = str(claims.get("deployment_id") or "").strip()
    cohort_id = str(claims.get("cohort_id") or "").strip()
    artifact_hashes = set(_dedupe_rows([str(row) for row in claims.get("artifact_hashes") or []]))
    try:
        image_ref, image_digest = production_image_binding_from_claims(claims)
    except ValueError:
        return False
    return bool(
        deployment_id
        and cohort_id
        and (
            not required_image_ref
            or hmac.compare_digest(image_ref, required_image_ref)
        )
        and (
            not required_image_digest
            or hmac.compare_digest(image_digest, required_image_digest)
        )
        and _canary_observations_satisfy_policy(claims, policy=policy)
        and set(required_artifact_hashes).issubset(artifact_hashes)
    )


def _artifact_kind_matches_requirement(artifact_id: str, receipt: ReleaseArtifactReceipt) -> bool:
    if artifact_id.startswith("artifact_release_bundle:"):
        return receipt.artifact_kind == "release_bundle"
    if artifact_id.startswith("artifact_smoke_report:"):
        return receipt.artifact_kind == "smoke_report"
    return receipt.artifact_kind != "canary_evidence"


def record_release_artifact_receipt(
    state: ReleaseWorkflowState,
    receipt: ReleaseArtifactReceipt | Dict[str, Any],
    *,
    artifact_store: Optional[ReleaseArtifactStore] = None,
    encoded_artifact: Optional[bytes] = None,
    verifier_credentials: Optional[Dict[str, Any]] = None,
) -> ReleaseWorkflowState:
    record = receipt if isinstance(receipt, ReleaseArtifactReceipt) else ReleaseArtifactReceipt.model_validate(receipt)
    if (
        record.candidate_ref != state.candidate_ref
        or record.release_id != state.release_id
        or record.revision_id != state.revision_id
    ):
        raise ValueError("artifact receipt is not bound to the active release candidate and revision")
    receipt_identity = (record.release_id, record.revision_id, record.artifact_id)
    existing = next(
        (
            row for row in list((state.metadata or {}).get("release_artifacts") or [])
            if isinstance(row, dict)
            and (
                str(row.get("release_id") or ""),
                str(row.get("revision_id") or ""),
                str(row.get("artifact_id") or ""),
            ) == receipt_identity
        ),
        None,
    )
    if existing is not None:
        existing_record = ReleaseArtifactReceipt.model_validate(existing)
        same_attested_evidence = bool(
            hmac.compare_digest(
                _artifact_attestation_payload(existing_record.model_dump()),
                _artifact_attestation_payload(record.model_dump()),
            )
            and hmac.compare_digest(
                existing_record.attestation_signature,
                record.attestation_signature,
            )
        )
        supplied_acceptance_matches = bool(
            record.acceptance_epoch is None
            or record.acceptance_epoch == existing_record.acceptance_epoch
        )
        if not same_attested_evidence or not supplied_acceptance_matches:
            raise ValueError(f"immutable release artifact receipt already exists: {record.artifact_id}")
        record = existing_record
    else:
        if record.acceptance_epoch is not None:
            raise ValueError("release artifact acceptance_epoch is assigned by the server")
        record = record.model_copy(update={"acceptance_epoch": _now().timestamp()})
    require_current_verifier = existing is None
    if encoded_artifact is not None:
        verify_release_artifact_receipt_payload(
            record,
            encoded=bytes(encoded_artifact),
            verifier_credentials=verifier_credentials,
            require_current_verifier=require_current_verifier,
        )
    elif artifact_store is not None:
        verify_release_artifact_receipt(
            record,
            artifact_store=artifact_store,
            verifier_credentials=verifier_credentials,
            require_current_verifier=require_current_verifier,
        )
    else:
        raise ValueError("artifact_store or encoded_artifact is required")
    rows = [
        row for row in list((state.metadata or {}).get("release_artifacts") or [])
        if not (
            isinstance(row, dict)
            and (
                str(row.get("release_id") or ""),
                str(row.get("revision_id") or ""),
                str(row.get("artifact_id") or ""),
            ) == receipt_identity
        )
    ]
    if existing is None and len(rows) >= MAX_RELEASE_ARTIFACT_RECEIPTS:
        raise ValueError(
            f"release artifact receipt count exceeds immutable limit of {MAX_RELEASE_ARTIFACT_RECEIPTS}"
        )
    rows.append(record.model_dump())
    metadata = {**dict(state.metadata), "release_artifacts": rows}
    if (
        record.artifact_kind == "release_bundle"
        and record.artifact_id.startswith("artifact_release_bundle:")
        and record.validation_outcome == "passed"
    ):
        image_ref, image_digest = production_image_binding_from_claims(record.claims)
        existing_ref = str(metadata.get("production_image_ref") or "").strip()
        existing_digest = str(metadata.get("production_image_digest") or "").strip()
        if existing_ref or existing_digest:
            bound_ref, bound_digest = normalize_production_image_binding(
                image_ref=existing_ref,
                image_digest=existing_digest,
            )
            if not (
                hmac.compare_digest(bound_ref, image_ref)
                and hmac.compare_digest(bound_digest, image_digest)
            ):
                raise ValueError("release revision production image binding is immutable")
        metadata["production_image_ref"] = image_ref
        metadata["production_image_digest"] = image_digest
    return _copy_state(
        state,
        metadata=metadata,
        updated_at=_now_iso(),
    )


class ReleaseWorkflowHistoryRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")

    history_id: str = Field(default_factory=_history_id)
    process_id: str
    release_id: str
    revision_id: str
    current_stage: str
    status: str
    actor: Optional[str] = None
    provenance: Dict[str, Any] = Field(default_factory=dict)
    change_set: Dict[str, Any] = Field(default_factory=dict)
    state: Dict[str, Any]
    recorded_at: str = Field(default_factory=_now_iso)

    @field_validator("history_id", "process_id", "release_id", "revision_id", "current_stage", "status", "recorded_at")
    @classmethod
    def _validate_non_empty(cls, value: str) -> str:
        value = str(value or "").strip()
        if not value:
            raise ValueError("must be non-empty")
        return value



def _workflow_validate_compat(data: Dict[str, Any]) -> ReleaseWorkflowState:
    if hasattr(ReleaseWorkflowState, "model_validate"):
        return ReleaseWorkflowState.model_validate(data)
    return ReleaseWorkflowState.parse_obj(data)



def _workflow_dump_compat(model: ReleaseWorkflowState) -> Dict[str, Any]:
    if hasattr(model, "model_dump"):
        return model.model_dump()
    return model.dict()



def _history_validate_compat(data: Dict[str, Any]) -> ReleaseWorkflowHistoryRecord:
    if hasattr(ReleaseWorkflowHistoryRecord, "model_validate"):
        return ReleaseWorkflowHistoryRecord.model_validate(data)
    return ReleaseWorkflowHistoryRecord.parse_obj(data)



def _history_dump_compat(model: ReleaseWorkflowHistoryRecord) -> Dict[str, Any]:
    if hasattr(model, "model_dump"):
        return model.model_dump()
    return model.dict()



def _copy_state(state: ReleaseWorkflowState, **updates: Any) -> ReleaseWorkflowState:
    data = _workflow_dump_compat(state)
    data.update(updates)
    return _workflow_validate_compat(data)



def _state_change_set(before: Optional[ReleaseWorkflowState], after: ReleaseWorkflowState) -> Dict[str, Any]:
    previous_safe_push = None
    if before:
        previous_safe_push = bool((before.safe_push_criteria or {}).get("safe_push")) if before.safe_push_criteria else None
    current_safe_push = bool((after.safe_push_criteria or {}).get("safe_push")) if after.safe_push_criteria else None
    return {
        "created": before is None,
        "persistence_revision_before": before.persistence_revision if before else 0,
        "persistence_revision_after": after.persistence_revision,
        "from_revision_id": before.revision_id if before else None,
        "to_revision_id": after.revision_id,
        "previous_stage": before.current_stage if before else None,
        "current_stage": after.current_stage,
        "status_before": before.status if before else None,
        "status_after": after.status,
        "promotion_count_before": len(before.promotion_history) if before else 0,
        "promotion_count_after": len(after.promotion_history),
        "handoff_count_before": len(before.handoff_records) if before else 0,
        "handoff_count_after": len(after.handoff_records),
        "fencepost_count_before": len(before.rollback_fenceposts) if before else 0,
        "fencepost_count_after": len(after.rollback_fenceposts),
        "operator_hold_count_before": len(before.operator_holds) if before else 0,
        "operator_hold_count_after": len(after.operator_holds),
        "safe_push_before": previous_safe_push,
        "safe_push_after": current_safe_push,
    }


class ReleaseWorkflowStore:
    def __init__(self, path: str | Path):
        self.path = Path(path).expanduser()
        self._transaction_local = threading.local()
        self._cleanup_legacy_lock_files()

    def _store_root(self) -> Path:
        root = self.path.parent if self.path.suffix else self.path
        return root.resolve(strict=False)

    def _contained(self, candidate: Path) -> Path:
        root = self._store_root()
        resolved = candidate.resolve(strict=False)
        try:
            resolved.relative_to(root)
        except ValueError as exc:
            raise ValueError("release workflow path escapes its configured store root") from exc
        return resolved

    def _cleanup_legacy_lock_files(self) -> None:
        """Remove obsolete caller-named locks before using bounded lock stripes."""

        root = self.path.parent if self.path.suffix else self.path
        if not root.is_dir() or root.is_symlink():
            return
        touched_directories: set[Path] = set()
        legacy_parents: set[Path] = set()
        for directory, directory_names, file_names in os.walk(
            root, topdown=True, followlinks=False
        ):
            parent = Path(directory)
            directory_names[:] = [
                name for name in directory_names if not (parent / name).is_symlink()
            ]
            for name in file_names:
                candidate = parent / name
                if (
                    _LEGACY_RELEASE_LOCK_RE.fullmatch(name)
                    and candidate.is_file()
                    and not candidate.is_symlink()
                ):
                    candidate.unlink()
                    touched_directories.add(parent)
                    legacy_parents.add(parent)
        cleanup_candidates: set[Path] = set()
        for parent in legacy_parents:
            current = parent
            while current != root:
                cleanup_candidates.add(current)
                current = current.parent
        for candidate in sorted(
            cleanup_candidates, key=lambda path: len(path.parts), reverse=True
        ):
            try:
                candidate.rmdir()
            except OSError:
                continue
            touched_directories.add(candidate.parent)
        for directory in sorted(touched_directories, key=str):
            if directory.is_dir() and not directory.is_symlink():
                fsync_directory(directory)

    def _target(self, process_id: Optional[str] = None) -> Path:
        if self.path.suffix:
            if process_id is not None:
                release_opaque_identifier(process_id, field="process_id")
            return self._contained(self.path)
        if not process_id:
            raise ValueError("process_id required when release store path is a directory")
        process = release_opaque_identifier(process_id, field="process_id")
        return self._contained(self.path / f"{process}.json")

    def _history_target(self, process_id: str) -> Path:
        process = release_opaque_identifier(process_id, field="process_id")
        if self.path.suffix:
            return self._contained(
                self.path.with_name(self.path.name + f".{process}.history.jsonl")
            )
        return self._contained(self.path / "history" / f"{process}.jsonl")

    def _save_intent_target(self, process_id: str) -> Path:
        target = self._target(process_id)
        return target.with_name(f".{target.name}.save-intent.json")

    def _save_stage_target(self, process_id: str) -> Path:
        target = self._target(process_id)
        return target.with_name(f".{target.name}.save-state.stage")

    @staticmethod
    def _remove_durable(path: Path) -> None:
        try:
            path.unlink()
        except FileNotFoundError:
            return
        fsync_directory(path.parent)

    @staticmethod
    def _publish_stage(stage: Path, target: Path) -> None:
        if not stage.is_file() or stage.is_symlink():
            raise RuntimeError(f"release workflow recovery stage is missing: {stage}")
        os.replace(stage, target)
        fsync_directory(target.parent)

    def _load_unlocked(self, process_id: str) -> Optional[ReleaseWorkflowState]:
        target = self._target(process_id)
        if not target.exists():
            return None
        return _workflow_validate_compat(json.loads(target.read_text(encoding="utf-8")))

    def _history_unlocked(self, process_id: str) -> List[ReleaseWorkflowHistoryRecord]:
        target = self._history_target(process_id)
        if not target.exists():
            return []
        return [
            _history_validate_compat(row)
            for row in read_recoverable_jsonl(target)
        ]

    @staticmethod
    def _history_persistence_revision(record: ReleaseWorkflowHistoryRecord) -> int:
        value = (record.provenance or {}).get("persistence_revision")
        if type(value) is not int or value <= 0:
            raise RuntimeError("release history persistence revision is invalid")
        return value

    def _validate_history_projection(
        self,
        rows: List[ReleaseWorkflowHistoryRecord],
        current: Optional[ReleaseWorkflowState],
    ) -> None:
        seen_ids: set[str] = set()
        previous = 0
        for row in rows:
            revision = self._history_persistence_revision(row)
            if row.history_id in seen_ids or revision != previous + 1:
                raise RuntimeError("release workflow history revision chain is broken")
            seen_ids.add(row.history_id)
            previous = revision
        if current is None:
            if rows:
                raise RuntimeError("release history exists without authoritative state")
        elif not rows or previous != current.persistence_revision:
            raise RuntimeError("authoritative release revision is missing from history")

    def _recover_pending_save(self, process_id: str) -> None:
        intent_target = self._save_intent_target(process_id)
        stage_target = self._save_stage_target(process_id)
        if not intent_target.exists():
            self._remove_durable(stage_target)
            return
        intent = json.loads(intent_target.read_text(encoding="utf-8"))
        if (
            not isinstance(intent, dict)
            or intent.get("version") != "cortex.release-workflow-save-intent.v1"
            or str(intent.get("process_id") or "") != process_id
        ):
            raise RuntimeError("release workflow save intent is invalid")
        intended_revision = int(intent.get("persistence_revision") or 0)
        expected_hash = str(intent.get("state_sha256") or "")
        target = self._target(process_id)
        source = stage_target if stage_target.exists() else target
        state_bytes = source.read_bytes()
        if hashlib.sha256(state_bytes).hexdigest() != expected_hash:
            raise RuntimeError("release workflow save intent payload hash mismatch")
        persisted = _workflow_validate_compat(json.loads(state_bytes))
        if (
            persisted.process_id != process_id
            or persisted.persistence_revision != intended_revision
        ):
            raise RuntimeError("release workflow save intent is not revision bound")
        current = self._load_unlocked(process_id)
        current_revision = current.persistence_revision if current else 0
        if current_revision not in {intended_revision - 1, intended_revision}:
            raise RuntimeError("release workflow advanced past an unresolved save intent")
        history_record = ReleaseWorkflowHistoryRecord(
            history_id=str(intent.get("history_id") or ""),
            process_id=persisted.process_id,
            release_id=persisted.release_id,
            revision_id=persisted.revision_id,
            current_stage=persisted.current_stage,
            status=persisted.status,
            actor=str(intent.get("actor") or "").strip() or None,
            provenance=dict(intent.get("provenance") or {}),
            change_set=(
                dict(intent.get("change_set") or {})
                if current_revision == intended_revision
                else _state_change_set(current, persisted)
            ),
            state=self._history_state_payload(
                persisted, dict(intent.get("source_provenance") or {})
            ),
            recorded_at=str(intent.get("recorded_at") or ""),
        )
        rows = self._history_unlocked(process_id)
        existing = next(
            (row for row in rows if row.history_id == history_record.history_id), None
        )
        if existing is None:
            if current_revision == intended_revision:
                raise RuntimeError("committed release state has no recoverable history frame")
            self._append_history(history_record)
        elif _history_dump_compat(existing) != _history_dump_compat(history_record):
            raise RuntimeError("release workflow history conflicts with save intent")
        if stage_target.exists():
            self._publish_stage(stage_target, target)
        self._remove_durable(intent_target)
        self._validate_history_projection(
            self._history_unlocked(process_id), self._load_unlocked(process_id)
        )

    def _append_history(self, record: ReleaseWorkflowHistoryRecord) -> None:
        target = self._history_target(record.process_id)
        _append_fsynced_jsonl(target, _history_dump_compat(record))

    @contextmanager
    def _metadata_quota_transaction(self):
        """Serialize aggregate metadata admission across releases and workers."""

        root = self.path.parent if self.path.suffix else self.path
        lock_target = root / ".release-metadata-quota.lock"
        lock_key = str(lock_target.resolve())
        with _RELEASE_METADATA_LOCKS_GUARD:
            thread_lock = _RELEASE_METADATA_LOCKS.setdefault(lock_key, threading.RLock())
        with thread_lock:
            durable_mkdir(lock_target.parent)
            with lock_target.open("a+b") as handle:
                fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
                try:
                    yield
                finally:
                    fcntl.flock(handle.fileno(), fcntl.LOCK_UN)

    @staticmethod
    def _history_state_payload(
        state: ReleaseWorkflowState,
        provenance: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Use receipt deltas for artifact ingestion instead of quadratic snapshots."""

        payload = _workflow_dump_compat(state)
        if str(provenance.get("scenario") or "") != "production_artifact_ingestion":
            return payload
        artifact_id = str(provenance.get("artifact_id") or "")
        content_hash = str(provenance.get("content_hash") or "")
        receipts = list((state.metadata or {}).get("release_artifacts") or [])
        receipt = next(
            (
                row
                for row in reversed(receipts)
                if isinstance(row, dict)
                and str(row.get("artifact_id") or "") == artifact_id
                and str(row.get("content_hash") or "") == content_hash
            ),
            None,
        )
        canonical = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
        return {
            "history_format": "cortex.release-history-artifact-delta.v1",
            "process_id": state.process_id,
            "release_id": state.release_id,
            "candidate_ref": state.candidate_ref,
            "target_environment": state.target_environment,
            "revision_id": state.revision_id,
            "current_stage": state.current_stage,
            "status": state.status,
            "persistence_revision": state.persistence_revision,
            "updated_at": state.updated_at,
            "state_sha256": hashlib.sha256(canonical).hexdigest(),
            "release_artifact_count": len(receipts),
            "artifact_receipt": receipt,
        }

    @staticmethod
    def _encoded_json(payload: Dict[str, Any], *, pretty: bool) -> bytes:
        return (
            json.dumps(
                payload,
                sort_keys=True,
                indent=2 if pretty else None,
                separators=None if pretty else (",", ":"),
            )
            + "\n"
        ).encode("utf-8")

    def _assert_durable_metadata_capacity(
        self,
        state: ReleaseWorkflowState,
        history_record: ReleaseWorkflowHistoryRecord,
        *,
        save_intent_bytes: int = 0,
        recovery_admission: bool = False,
    ) -> None:
        state_payload = _workflow_dump_compat(state)
        receipts = list((state.metadata or {}).get("release_artifacts") or [])
        if len(receipts) > MAX_RELEASE_ARTIFACT_RECEIPTS:
            raise ValueError(
                f"release artifact receipt count exceeds immutable limit of {MAX_RELEASE_ARTIFACT_RECEIPTS}"
            )
        receipt_bytes = sum(
            len(self._encoded_json(receipt, pretty=False))
            for receipt in receipts
            if isinstance(receipt, dict)
        )
        if receipt_bytes > MAX_RELEASE_RECEIPT_METADATA_BYTES:
            raise ValueError(
                "release artifact receipt metadata quota exceeded: "
                f"{receipt_bytes} > {MAX_RELEASE_RECEIPT_METADATA_BYTES} bytes"
            )
        state_bytes = len(self._encoded_json(state_payload, pretty=True))
        if state_bytes > MAX_RELEASE_STATE_BYTES:
            raise ValueError(
                f"release state quota exceeded: {state_bytes} > {MAX_RELEASE_STATE_BYTES} bytes"
            )
        history_target = self._history_target(state.process_id)
        history_bytes = history_target.stat().st_size if history_target.exists() else 0
        history_append_bytes = len(
            (json.dumps(_history_dump_compat(history_record), sort_keys=True) + "\n").encode("utf-8")
        )
        if history_append_bytes > MAX_RELEASE_HISTORY_FRAME_BYTES:
            raise ValueError(
                "release history frame quota exceeded: "
                f"{history_append_bytes} > {MAX_RELEASE_HISTORY_FRAME_BYTES} bytes"
            )
        if save_intent_bytes > MAX_RUNTIME_DELIVERY_OBJECT_BYTES:
            raise ValueError(
                "release save intent quota exceeded: "
                f"{save_intent_bytes} > {MAX_RUNTIME_DELIVERY_OBJECT_BYTES} bytes"
            )
        history_limit = MAX_RELEASE_HISTORY_BYTES - (
            0 if recovery_admission else RELEASE_HISTORY_RECOVERY_RESERVE_BYTES
        )
        if history_bytes + history_append_bytes > history_limit:
            raise ValueError(
                "release history quota exceeded: "
                f"{history_bytes + history_append_bytes} > {history_limit} bytes"
            )
        intent_target = self._rollback_intent_target(state.process_id)
        intent_bytes = intent_target.stat().st_size if intent_target.exists() else 0
        projected_process_bytes = (
            state_bytes
            + history_bytes
            + history_append_bytes
            + intent_bytes
            + save_intent_bytes
        )
        process_limit = MAX_RELEASE_PROCESS_DURABLE_BYTES - (
            0 if recovery_admission else RELEASE_PROCESS_RECOVERY_RESERVE_BYTES
        )
        if projected_process_bytes > process_limit:
            raise ValueError(
                "release process durable quota exceeded: "
                f"{projected_process_bytes} > {process_limit} bytes"
            )
        root = self.path.parent if self.path.suffix else self.path
        global_usage = 0
        if root.exists():
            for candidate in root.rglob("*"):
                if candidate.is_file():
                    global_usage += candidate.stat().st_size
        # Atomic publication temporarily retains the old state and the new
        # state together; count that temporary plus the pending history row.
        projected_global = (
            global_usage + state_bytes + history_append_bytes + save_intent_bytes
        )
        global_limit = MAX_RELEASE_GLOBAL_DURABLE_BYTES - (
            0 if recovery_admission else RELEASE_GLOBAL_RECOVERY_RESERVE_BYTES
        )
        if projected_global > global_limit:
            raise ValueError(
                "global release durable quota exceeded: "
                f"{projected_global} > {global_limit} bytes"
            )

    def _rollback_recovery_admitted(
        self,
        state: ReleaseWorkflowState,
        provenance: Dict[str, Any],
    ) -> bool:
        """Authorize logical reserve use only for a matching durable rollback."""

        if provenance.get("rollback") is not True:
            return False
        transaction_id = str(provenance.get("rollback_transaction_id") or "").strip()
        intent = self.load_rollback_intent(state.process_id)
        if (
            not transaction_id
            or intent is None
            or str(intent.get("process_id") or "") != state.process_id
            or str(intent.get("transaction_id") or "") != transaction_id
            or intent.get("status") not in {"in_progress", "recovery_required"}
        ):
            raise RuntimeError(
                "release recovery capacity requires a matching durable rollback intent"
            )
        return True

    def _rollback_intent_target(self, process_id: str) -> Path:
        target = self._target(process_id)
        return target.with_name(f".{target.name}.rollback-intent.json")

    def _rollback_lock_target(self, process_id: str) -> Path:
        process = release_opaque_identifier(process_id, field="process_id")
        stripe = int(hashlib.sha256(process.encode("utf-8")).hexdigest(), 16) % MAX_RELEASE_LOCK_STRIPES
        root = self.path.parent if self.path.suffix else self.path
        return self._contained(root / ".release-locks" / f"{stripe:02x}.lock")

    def _rollback_result_root(self, process_id: str) -> Path:
        process = release_opaque_identifier(process_id, field="process_id")
        store_root = self.path.parent if self.path.suffix else self.path
        process_digest = hashlib.sha256(process.encode("utf-8")).hexdigest()
        return self._contained(store_root / "rollback_results" / process_digest)

    def _rollback_result_target(self, process_id: str, idempotency_key: str) -> Path:
        key_digest = hashlib.sha256(str(idempotency_key).encode("utf-8")).hexdigest()
        return self._rollback_result_root(process_id) / f"{key_digest}.json"

    def artifact_store(self) -> ReleaseArtifactStore:
        root = self.path.parent / f"{self.path.stem}_artifacts" if self.path.suffix else self.path / "artifacts"
        return ReleaseArtifactStore(root, delivery_root=self.path.parent)

    def referenced_artifact_refs(self) -> List[str]:
        """Return the fail-closed durable reference set used by orphan cleanup."""

        if self.path.suffix:
            targets = [self.path] if self.path.exists() else []
        elif self.path.exists():
            targets = [
                target
                for target in sorted(self.path.glob("*.json"))
                if not target.name.startswith(".")
            ]
        else:
            targets = []
        if self.path.suffix:
            pending_intents = [
                self.path.with_name(f".{self.path.name}.save-intent.json")
            ]
        elif self.path.exists():
            pending_intents = sorted(self.path.glob(".*.json.save-intent.json"))
        else:
            pending_intents = []
        recoverable_states: List[tuple[Path, ReleaseWorkflowState]] = []
        for intent_target in pending_intents:
            if not intent_target.exists():
                continue
            intent = json.loads(intent_target.read_text(encoding="utf-8"))
            process_id = str(intent.get("process_id") or "").strip() if isinstance(intent, dict) else ""
            if (
                not isinstance(intent, dict)
                or intent.get("version") != "cortex.release-workflow-save-intent.v1"
                or not process_id
                or intent_target != self._save_intent_target(process_id)
            ):
                raise RuntimeError("release workflow save intent is invalid during artifact scan")
            intended_revision = int(intent.get("persistence_revision") or 0)
            expected_hash = str(intent.get("state_sha256") or "")
            stage_target = self._save_stage_target(process_id)
            source = stage_target if stage_target.exists() else self._target(process_id)
            if not source.is_file() or source.is_symlink():
                raise RuntimeError("release workflow recovery state is missing during artifact scan")
            state_bytes = source.read_bytes()
            if not hmac.compare_digest(hashlib.sha256(state_bytes).hexdigest(), expected_hash):
                raise RuntimeError("release workflow save intent payload hash mismatch during artifact scan")
            persisted = _workflow_validate_compat(json.loads(state_bytes))
            if (
                persisted.process_id != process_id
                or persisted.persistence_revision != intended_revision
            ):
                raise RuntimeError("release workflow save intent is not revision bound during artifact scan")
            current = self._load_unlocked(process_id)
            current_revision = current.persistence_revision if current else 0
            if current_revision not in {intended_revision - 1, intended_revision}:
                raise RuntimeError("release workflow save intent is not recoverable during artifact scan")
            recoverable_states.append((source, persisted))
        references: List[str] = []
        durable_states = [
            (target, _workflow_validate_compat(json.loads(target.read_text(encoding="utf-8"))))
            for target in targets
        ]
        for target, state in durable_states + recoverable_states:
            for receipt in list((state.metadata or {}).get("release_artifacts") or []):
                if not isinstance(receipt, dict):
                    raise ValueError(f"invalid release artifact receipt in {target}")
                artifact_ref = str(receipt.get("artifact_ref") or "").strip()
                if not artifact_ref:
                    raise ValueError(f"release artifact receipt missing reference in {target}")
                self.artifact_store()._target(artifact_ref)
                references.append(artifact_ref)
        return _dedupe_rows(references)

    @contextmanager
    def release_transaction(self, process_id: str, *, nonblocking: bool = False):
        """Serialize every release mutation for one process across processes.

        The transaction is re-entrant for callers such as reconciliation and
        rollback that compose store operations under one larger transaction.
        """

        process = release_opaque_identifier(process_id, field="process_id")
        depths = getattr(self._transaction_local, "depths", None)
        if depths is None:
            depths = {}
            self._transaction_local.depths = depths
        if int(depths.get(process, 0) or 0) > 0:
            depths[process] += 1
            try:
                yield
            finally:
                depths[process] -= 1
            return

        lock_target = self._rollback_lock_target(process)
        durable_mkdir(lock_target.parent)
        if lock_target.parent.is_symlink():
            raise ValueError("release lock directory cannot be a symbolic link")
        flags_open = os.O_RDWR | os.O_CREAT
        if hasattr(os, "O_CLOEXEC"):
            flags_open |= os.O_CLOEXEC
        if hasattr(os, "O_NOFOLLOW"):
            flags_open |= os.O_NOFOLLOW
        descriptor = os.open(lock_target, flags_open, 0o600)
        with os.fdopen(descriptor, "a+b") as handle:
            if not stat.S_ISREG(os.fstat(handle.fileno()).st_mode):
                raise ValueError("release transaction lock must be a regular file")
            os.fchmod(handle.fileno(), 0o600)
            flags = fcntl.LOCK_EX
            try:
                running_on_event_loop = asyncio.get_running_loop() is not None
            except RuntimeError:
                running_on_event_loop = False
            if nonblocking or running_on_event_loop:
                # A synchronous flock wait on the event-loop thread can
                # deadlock an async execution that owns this transaction.
                # Event-loop callers fail fast and may retry; worker threads
                # and ordinary synchronous reconciliation retain blocking
                # serialization.
                flags |= fcntl.LOCK_NB
            try:
                fcntl.flock(handle.fileno(), flags)
            except BlockingIOError as exc:
                raise RuntimeError(f"release transaction busy for {process}") from exc
            depths[process] = 1
            try:
                yield
            finally:
                depths.pop(process, None)
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)

    @contextmanager
    def rollback_transaction(self, process_id: str):
        # Backwards-compatible name for the now shared release transaction.
        with self.release_transaction(process_id):
            yield

    def load_rollback_intent(self, process_id: str) -> Optional[Dict[str, Any]]:
        target = self._rollback_intent_target(process_id)
        if not target.exists():
            return None
        data = json.loads(target.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            raise ValueError(f"invalid rollback intent for {process_id}")
        return data

    def assert_mutation_allowed(self, process_id: str, *, operation: str) -> None:
        """Fence non-recovery writers while rollback intent is durable."""

        intent = self.load_rollback_intent(process_id)
        if intent is not None and intent.get("status") in {"in_progress", "recovery_required"}:
            phase = str(intent.get("phase") or "unknown")
            raise RuntimeError(
                f"{operation} rejected while rollback recovery is pending for {process_id} at {phase}"
            )

    def pending_rollback_process_ids(self) -> List[str]:
        root = self.path.parent if self.path.suffix else self.path
        if not root.exists():
            return []
        process_ids: List[str] = []
        for target in sorted(root.glob(".*.json.rollback-intent.json")):
            try:
                payload = json.loads(target.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            process_id = str(payload.get("process_id") or "").strip() if isinstance(payload, dict) else ""
            if process_id and payload.get("status") in {"in_progress", "recovery_required"}:
                process_ids.append(process_id)
        return _dedupe_rows(process_ids)

    def save_rollback_intent(self, process_id: str, intent: Dict[str, Any]) -> Dict[str, Any]:
        payload = dict(intent)
        payload["process_id"] = process_id
        payload["updated_at"] = _now_iso()
        target = self._rollback_intent_target(process_id)
        encoded = self._encoded_json(payload, pretty=True)
        delivery_root = self.path.parent
        store_root = self.path.parent if self.path.suffix else self.path
        with runtime_delivery_quota_transaction(delivery_root):
            assert_process_count(store_root, process_id, delivery_root=delivery_root)
            assert_runtime_delivery_capacity(
                delivery_root=delivery_root,
                store_root=store_root,
                process_id=process_id,
                object_bytes=len(encoded),
                additional_bytes=len(encoded),
                replacing=target,
            )
            _atomic_write_json(target, payload)
        return payload

    def load_rollback_result(
        self,
        process_id: str,
        idempotency_key: str,
    ) -> Optional[Dict[str, Any]]:
        target = self._rollback_result_target(process_id, idempotency_key)
        if not target.exists():
            return None
        payload = json.loads(target.read_text(encoding="utf-8"))
        if (
            not isinstance(payload, dict)
            or payload.get("version") != "cortex.release-rollback-result.v1"
            or str(payload.get("process_id") or "") != str(process_id)
            or str(payload.get("idempotency_key") or "") != str(idempotency_key)
            or not isinstance(payload.get("committed_response"), dict)
        ):
            raise ValueError(f"invalid committed rollback result for {process_id}")
        return payload

    def save_rollback_result(
        self,
        process_id: str,
        *,
        idempotency_key: str,
        request_fingerprint: str,
        committed_response: Dict[str, Any],
    ) -> Dict[str, Any]:
        target = self._rollback_result_target(process_id, idempotency_key)
        root = target.parent
        if not target.exists() and root.exists():
            existing = list(root.glob("*.json"))
            if len(existing) >= MAX_RELEASE_ROLLBACK_IDEMPOTENCY_RESULTS:
                raise ValueError("release rollback idempotency result quota exceeded")
        payload = {
            "version": "cortex.release-rollback-result.v1",
            "process_id": process_id,
            "idempotency_key": idempotency_key,
            "request_fingerprint": request_fingerprint,
            "committed_response": committed_response,
            "committed_at": _now_iso(),
        }
        encoded = self._encoded_json(payload, pretty=True)
        delivery_root = self.path.parent
        with runtime_delivery_quota_transaction(delivery_root):
            assert_process_count(
                self.path.parent if self.path.suffix else self.path,
                process_id,
                delivery_root=delivery_root,
            )
            assert_runtime_delivery_capacity(
                delivery_root=delivery_root,
                store_root=root,
                process_id=process_id,
                object_bytes=len(encoded),
                additional_bytes=len(encoded),
                replacing=target,
            )
            _atomic_write_json(target, payload)
        return payload

    def load(self, process_id: Optional[str] = None) -> Optional[ReleaseWorkflowState]:
        resolved_process = str(process_id or "").strip()
        if resolved_process:
            resolved_process = release_opaque_identifier(
                resolved_process, field="process_id"
            )
            target = self._target(resolved_process)
            intent_target = self._save_intent_target(resolved_process)
            if not target.exists() and not intent_target.exists():
                return None
        if not resolved_process:
            target = self._target(process_id)
            intent_target = target.with_name(f".{target.name}.save-intent.json")
            source = intent_target if intent_target.exists() else target
            if not source.exists():
                return None
            payload = json.loads(source.read_text(encoding="utf-8"))
            resolved_process = str(payload.get("process_id") or "").strip()
            if not resolved_process:
                raise RuntimeError("release workflow process identity is missing")
        with self.release_transaction(resolved_process):
            self._recover_pending_save(resolved_process)
            current = self._load_unlocked(resolved_process)
            self._validate_history_projection(
                self._history_unlocked(resolved_process), current
            )
            return current

    def load_for_observation(
        self, process_id: str
    ) -> Optional[ReleaseWorkflowState]:
        """Read a stable release state without recovery, locks, or filesystem writes."""

        process = release_opaque_identifier(process_id, field="process_id")
        target = self._target(process)
        intent_target = self._save_intent_target(process)
        if intent_target.exists() or not target.exists():
            return None
        if target.is_symlink() or not target.is_file():
            raise RuntimeError("release workflow observation target is not a regular file")
        current = _workflow_validate_compat(json.loads(target.read_text(encoding="utf-8")))
        if current.process_id != process:
            raise RuntimeError("release workflow observation identity mismatch")
        return current

    def history(self, process_id: str) -> List[ReleaseWorkflowHistoryRecord]:
        with self.release_transaction(process_id):
            self._recover_pending_save(process_id)
            rows = self._history_unlocked(process_id)
            self._validate_history_projection(rows, self._load_unlocked(process_id))
            return rows

    def save(
        self,
        state: ReleaseWorkflowState | Dict[str, Any],
        *,
        actor: Optional[str] = None,
        provenance: Optional[Dict[str, Any]] = None,
    ) -> ReleaseWorkflowState:
        record = state if isinstance(state, ReleaseWorkflowState) else _workflow_validate_compat(dict(state))
        source_provenance = dict(provenance or {})
        with self.release_transaction(record.process_id):
            self._recover_pending_save(record.process_id)
            current = self._load_unlocked(record.process_id)
            self._validate_history_projection(
                self._history_unlocked(record.process_id), current
            )
            expected_revision = int(record.persistence_revision or 0)
            if current is None:
                if expected_revision != 0:
                    raise RuntimeError(
                        f"release workflow persistence conflict for {record.process_id}: "
                        f"expected new state at revision 0, received {expected_revision}"
                    )
                next_revision = 1
            else:
                if current.release_id != record.release_id:
                    raise RuntimeError(
                        f"release workflow identity conflict for {record.process_id}: "
                        f"stored={current.release_id}, received={record.release_id}"
                    )
                if expected_revision != current.persistence_revision:
                    raise RuntimeError(
                        f"release workflow persistence conflict for {record.process_id}: "
                        f"expected {expected_revision}, current {current.persistence_revision}"
                    )
                next_revision = current.persistence_revision + 1

            persisted = _copy_state(record, persistence_revision=next_revision)
            history_record = ReleaseWorkflowHistoryRecord(
                process_id=persisted.process_id,
                release_id=persisted.release_id,
                revision_id=persisted.revision_id,
                current_stage=persisted.current_stage,
                status=persisted.status,
                actor=str(actor or "").strip() or None,
                provenance={
                    **source_provenance,
                    "persistence_revision": next_revision,
                },
                change_set=_state_change_set(current, persisted),
                state=self._history_state_payload(persisted, source_provenance),
            )
            recovery_admission = self._rollback_recovery_admitted(
                persisted,
                source_provenance,
            )
            with self._metadata_quota_transaction():
                delivery_root = self.path.parent
                state_payload = _workflow_dump_compat(persisted)
                state_encoded = self._encoded_json(state_payload, pretty=True)
                state_bytes = len(state_encoded)
                history_bytes = len(
                    (json.dumps(_history_dump_compat(history_record), sort_keys=True) + "\n").encode("utf-8")
                )
                intent_payload = {
                    "version": "cortex.release-workflow-save-intent.v1",
                    "process_id": persisted.process_id,
                    "persistence_revision": next_revision,
                    "state_sha256": hashlib.sha256(state_encoded).hexdigest(),
                    "history_id": history_record.history_id,
                    "actor": history_record.actor,
                    "provenance": dict(history_record.provenance),
                    "source_provenance": source_provenance,
                    "change_set": dict(history_record.change_set),
                    "recorded_at": history_record.recorded_at,
                }
                intent_encoded = self._encoded_json(intent_payload, pretty=True)
                with runtime_delivery_quota_transaction(delivery_root):
                    assert_process_count(
                        self.path.parent if self.path.suffix else self.path,
                        record.process_id,
                        delivery_root=delivery_root,
                    )
                    self._assert_durable_metadata_capacity(
                        persisted,
                        history_record,
                        save_intent_bytes=len(intent_encoded),
                        recovery_admission=recovery_admission,
                    )
                    assert_runtime_delivery_volume_capacity(
                        delivery_root,
                        additional_bytes=state_bytes + history_bytes + len(intent_encoded),
                    )
                    target = self._target(record.process_id)
                    stage_target = self._save_stage_target(record.process_id)
                    intent_target = self._save_intent_target(record.process_id)
                    _atomic_write_json(stage_target, state_payload)
                    _atomic_write_json(intent_target, intent_payload)
                    self._append_history(history_record)
                    self._publish_stage(stage_target, target)
                    self._remove_durable(intent_target)
                    if isinstance(state, ReleaseWorkflowState):
                        state.persistence_revision = next_revision
                    self._validate_history_projection(
                        self._history_unlocked(record.process_id),
                        self._load_unlocked(record.process_id),
                    )
            return persisted



def capture_release_rollback_fencepost(
    *,
    snapshot: ProcessSnapshot,
    shared_state: SharedProcessState,
    stage: str,
    latest_event: Optional[ProcessEvent] = None,
    image_ref: Optional[str] = None,
    image_digest: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> ReleaseRollbackFencepost:
    if snapshot.process_id != shared_state.process_id:
        raise ValueError("snapshot and shared_state must refer to the same process_id")
    stage_name = str(stage or "").strip()
    if not stage_name:
        raise ValueError("stage must be non-empty")
    normalized_image_ref: Optional[str] = None
    normalized_image_digest: Optional[str] = None
    if image_ref is not None or image_digest is not None:
        normalized_image_ref, normalized_image_digest = normalize_production_image_binding(
            image_ref=str(image_ref or ""),
            image_digest=str(image_digest or ""),
        )
    restore_state = {
        "process_id": snapshot.process_id,
        "snapshot_id": snapshot.snapshot_id,
        "shared_state_revision_id": shared_state.revision_id,
        "production_image_ref": normalized_image_ref,
        "production_image_digest": normalized_image_digest,
        "last_event_id": snapshot.last_event_id,
        "lifecycle_state": snapshot.lifecycle_state,
        "active_steps": list(snapshot.active_steps),
        "waiting_steps": list(snapshot.waiting_steps),
        "completed_steps": list(snapshot.completed_steps),
        "failed_steps": list(snapshot.failed_steps),
        "assigned_agents": dict(snapshot.assigned_agents),
        "runtime_policy": dict(snapshot.runtime_policy),
        "session_state": dict(snapshot.session_state),
        "goals": list(shared_state.goals),
        "open_decisions": [row.model_dump() if hasattr(row, "model_dump") else row.dict() for row in shared_state.open_decisions],
        "runtime_constraints": dict(shared_state.runtime_constraints),
        "world_state": {**dict(snapshot.world_state), **dict(shared_state.world_state)},
        "belief_refs": _dedupe_rows(list(snapshot.belief_refs) + list(shared_state.belief_refs)),
        "open_questions": list(shared_state.open_questions),
        "agent_ownership": dict(shared_state.agent_ownership),
        "operator_overrides": dict(shared_state.operator_overrides),
        "artifact_refs": _dedupe_rows(list(snapshot.artifact_refs)),
        "metadata": {
            **dict(snapshot.metadata),
            "fencepost_stage": stage_name,
            "fencepost_shared_state_revision_id": shared_state.revision_id,
        },
    }
    return ReleaseRollbackFencepost(
        process_id=snapshot.process_id,
        stage=stage_name,
        revision_id=shared_state.revision_id,
        snapshot_id=snapshot.snapshot_id,
        shared_state_revision_id=shared_state.revision_id,
        image_ref=normalized_image_ref,
        image_digest=normalized_image_digest,
        last_event_id=(latest_event.event_id if latest_event else snapshot.last_event_id),
        lifecycle_state=snapshot.lifecycle_state,
        restore_state=restore_state,
        metadata={
            **dict(metadata or {}),
            "snapshot_event_count": int(snapshot.event_count or 0),
            "shared_state_id": shared_state.state_id,
            "production_image_ref": normalized_image_ref,
            "production_image_digest": normalized_image_digest,
        },
    )



def record_release_fencepost(state: ReleaseWorkflowState, fencepost: ReleaseRollbackFencepost) -> ReleaseWorkflowState:
    if fencepost.process_id != state.process_id:
        raise ValueError("fencepost process_id must match release workflow state")
    state_ref = str((state.metadata or {}).get("production_image_ref") or "").strip()
    state_digest = str((state.metadata or {}).get("production_image_digest") or "").strip()
    if state_ref or state_digest:
        bound_ref, bound_digest = normalize_production_image_binding(
            image_ref=state_ref,
            image_digest=state_digest,
        )
        if not fencepost.image_ref and not fencepost.image_digest:
            fencepost = fencepost.model_copy(
                update={"image_ref": bound_ref, "image_digest": bound_digest}
            )
            fencepost.restore_state = {
                **dict(fencepost.restore_state or {}),
                "production_image_ref": bound_ref,
                "production_image_digest": bound_digest,
            }
            fencepost.metadata = {
                **dict(fencepost.metadata or {}),
                "production_image_ref": bound_ref,
                "production_image_digest": bound_digest,
            }
        elif not (
            hmac.compare_digest(str(fencepost.image_ref), bound_ref)
            and hmac.compare_digest(str(fencepost.image_digest), bound_digest)
        ):
            raise ValueError("rollback fencepost must preserve the active production image binding")
    rows = [row for row in state.rollback_fenceposts if row.stage != fencepost.stage]
    rows.append(fencepost)
    rows = sorted(rows, key=lambda row: row.created_at)
    return _copy_state(state, rollback_fenceposts=rows, updated_at=_now_iso())



def record_release_handoff(
    state: ReleaseWorkflowState,
    message: AgentMessage,
    *,
    stage: Optional[str] = None,
    notes: Optional[str] = None,
) -> ReleaseWorkflowState:
    if message.process_id != state.process_id:
        raise ValueError("message process_id must match release workflow state")
    message_metadata = dict(message.metadata or {})
    record = {
        "message_id": message.message_id,
        "handoff_id": message.handoff_id,
        "stage": str(message_metadata.get("target_stage") or stage or state.current_stage).strip() or state.current_stage,
        "from_agent": message.from_agent,
        "to_agent": message.to_agent,
        "delivery_status": message.delivery_status,
        "revision_id": message.revision_id,
        "release_id": str(message_metadata.get("release_id") or state.release_id).strip(),
        "candidate_ref": str(message_metadata.get("candidate_ref") or state.candidate_ref).strip(),
        "lease_id": str(message_metadata.get("lease_id") or "").strip() or None,
        "lease_generation": message_metadata.get("lease_generation"),
        "lease_scope": str(message_metadata.get("lease_scope") or "").strip() or None,
        "created_at": message.created_at,
        "acked_at": message.acked_at,
        "dead_lettered_at": message.dead_lettered_at,
        "notes": str(notes or "").strip() or None,
    }
    rows: List[Dict[str, Any]] = []
    replaced = False
    for row in state.handoff_records:
        if str(row.get("message_id") or "").strip() == message.message_id:
            merged = {**row, **record}
            rows.append(merged)
            replaced = True
        else:
            rows.append(dict(row))
    if not replaced:
        rows.append(record)
    return _copy_state(state, handoff_records=rows, updated_at=_now_iso())



def compile_release_handoff(
    *,
    state: ReleaseWorkflowState,
    shared_state: SharedProcessState,
    from_agent: str,
    to_agent: str,
    objective: str,
    scope: str,
    expected_output: str,
    gate: Optional[Dict[str, Any]] = None,
    snapshot: Optional[ProcessSnapshot] = None,
    open_questions: Optional[List[str]] = None,
    relevant_artifact_ids: Optional[List[str]] = None,
    relevant_evidence_ids: Optional[List[str]] = None,
    timeout_seconds: Optional[int] = None,
    lease_seconds: Optional[int] = None,
) -> HandoffContract:
    if shared_state.process_id != state.process_id:
        raise ValueError("shared_state process_id must match release workflow state")
    artifacts = _dedupe_rows(
        list(relevant_artifact_ids or [])
        + (list(snapshot.artifact_refs) if snapshot else [])
        + [
            str(row.get("artifact_id") or "")
            for row in (state.metadata.get("release_artifacts") or [])
            if isinstance(row, dict)
            and str(row.get("release_id") or "") == state.release_id
            and str(row.get("revision_id") or "") == state.revision_id
        ]
    )
    evidence_ids = _dedupe_rows(list(relevant_evidence_ids or []))
    gate_blockers = [str(row.get("summary") or row) for row in (gate or {}).get("blockers", []) if str(row.get("summary") if isinstance(row, dict) else row).strip()]
    handoff_questions = _dedupe_rows(list(open_questions or []) + gate_blockers + list(shared_state.open_questions))
    assumptions = _dedupe_rows(
        [
            f"release stage={state.current_stage}",
            f"candidate ref={state.candidate_ref}",
            f"target environment={state.target_environment}",
            f"shared revision={shared_state.revision_id}",
        ]
        + ([f"safe push={bool((gate or {}).get('safe_push'))}"] if gate is not None else [])
    )
    return HandoffContract(
        process_id=state.process_id,
        from_agent=from_agent,
        to_agent=to_agent,
        source_revision=shared_state.revision_id,
        objective=objective,
        scope=scope,
        assumptions=assumptions,
        relevant_evidence=[HandoffEvidenceRef(ref_id=ref_id, summary="release gate evidence") for ref_id in evidence_ids],
        relevant_artifacts=[HandoffArtifactRef(artifact_id=artifact_id, summary="release workflow artifact") for artifact_id in artifacts],
        open_questions=handoff_questions,
        expected_output=expected_output,
        timeout_seconds=timeout_seconds,
        lease_seconds=lease_seconds,
        metadata={
            "release_id": state.release_id,
            "current_stage": state.current_stage,
            "target_environment": state.target_environment,
            "candidate_ref": state.candidate_ref,
            "gate_safe_push": bool((gate or {}).get("safe_push")) if gate is not None else None,
        },
    )



def evaluate_release_promotion_gate(
    *,
    state: ReleaseWorkflowState,
    snapshot: ProcessSnapshot,
    shared_state: SharedProcessState,
    target_stage: str,
    mailbox_messages: Optional[List[AgentMessage]] = None,
    leases: Optional[List[AgentLease]] = None,
    dependability_report: Optional[JsonDict] = None,
    required_fencepost_stages: Optional[List[str]] = None,
    required_artifacts: Optional[List[str]] = None,
    required_handoff_count: int = 0,
    allowed_active_agents: Optional[List[str]] = None,
    allowed_lifecycle_states: Optional[List[str]] = None,
    require_dependability: bool = True,
    artifact_store: Optional[ReleaseArtifactStore] = None,
    verifier_credentials: Optional[Dict[str, Any]] = None,
) -> JsonDict:
    if snapshot.process_id != state.process_id or shared_state.process_id != state.process_id:
        raise ValueError("release workflow state, snapshot, and shared_state must refer to the same process_id")

    target = str(target_stage or "").strip()
    if not target:
        raise ValueError("target_stage must be non-empty")

    required_fenceposts = _dedupe_rows(list(required_fencepost_stages or []))
    required_artifact_ids = _dedupe_rows(list(required_artifacts or []))
    allowed_lifecycle = _dedupe_rows(list(allowed_lifecycle_states or ["waiting", "completed"]))
    allowed_agents = set(_dedupe_rows(list(allowed_active_agents or [])))

    target_records = [
        row
        for row in (state.handoff_records or [])
        if str(row.get("stage") or "").strip() == target
    ]
    current_handoff_records = [
        row
        for row in target_records
        if str(row.get("revision_id") or "").strip() == shared_state.revision_id
        and str(row.get("release_id") or "").strip() == state.release_id
        and str(row.get("candidate_ref") or "").strip() == state.candidate_ref
    ]
    tracked_message_ids = {
        str(row.get("message_id") or "").strip()
        for row in current_handoff_records
        if str(row.get("message_id") or "").strip()
    }
    relevant_messages = [
        row
        for row in (mailbox_messages or [])
        if row.process_id == state.process_id and row.message_id in tracked_message_ids
    ]
    dead_letter_messages = [row for row in relevant_messages if row.delivery_status == "dead_letter"]
    stale_handoff_records = [
        row
        for row in target_records
        if row not in current_handoff_records
    ]

    process_leases = [row for row in (leases or []) if row.process_id == state.process_id]
    active_leases = [row for row in process_leases if row.status == "active"]
    stale_leases = [row for row in process_leases if row.status == "stale"]
    unexpected_active_leases = [
        row for row in active_leases if not allowed_agents or str(row.agent_id or "").strip() not in allowed_agents
    ]

    present_fenceposts = {row.stage: row for row in state.rollback_fenceposts}
    missing_fenceposts = [stage for stage in required_fenceposts if stage not in present_fenceposts]

    valid_artifact_receipts: List[ReleaseArtifactReceipt] = []
    invalid_artifact_receipts: List[str] = []
    for raw_receipt in state.metadata.get("release_artifacts") or []:
        try:
            receipt = ReleaseArtifactReceipt.model_validate(raw_receipt)
            if artifact_store is None:
                raise ValueError("immutable artifact store is required")
            verify_release_artifact_receipt(
                receipt,
                artifact_store=artifact_store,
                verifier_credentials=verifier_credentials,
            )
        except Exception:
            invalid_artifact_receipts.append(
                str((raw_receipt or {}).get("artifact_id") or "invalid_receipt")
                if isinstance(raw_receipt, dict)
                else "invalid_receipt"
            )
            continue
        if (
            receipt.candidate_ref != state.candidate_ref
            or receipt.release_id != state.release_id
            or receipt.revision_id != shared_state.revision_id
            or receipt.validation_outcome != "passed"
        ):
            invalid_artifact_receipts.append(receipt.artifact_id)
            continue
        valid_artifact_receipts.append(receipt)
    valid_receipts_by_id = {receipt.artifact_id: receipt for receipt in valid_artifact_receipts}
    present_artifacts = set(valid_receipts_by_id)
    missing_artifacts = [
        artifact_id for artifact_id in required_artifact_ids
        if artifact_id not in valid_receipts_by_id
        or not _artifact_kind_matches_requirement(artifact_id, valid_receipts_by_id[artifact_id])
    ]
    required_artifact_hashes = [
        valid_receipts_by_id[artifact_id].content_hash
        for artifact_id in required_artifact_ids
        if artifact_id in valid_receipts_by_id
        and _artifact_kind_matches_requirement(artifact_id, valid_receipts_by_id[artifact_id])
    ]
    required_release_bundles = [
        valid_receipts_by_id[artifact_id]
        for artifact_id in required_artifact_ids
        if artifact_id.startswith("artifact_release_bundle:")
        and artifact_id in valid_receipts_by_id
        and valid_receipts_by_id[artifact_id].artifact_kind == "release_bundle"
    ]
    image_binding_required = any(
        artifact_id.startswith("artifact_release_bundle:")
        for artifact_id in required_artifact_ids
    )
    required_image_ref = ""
    required_image_digest = ""
    image_binding_ready = not image_binding_required
    if image_binding_required and len(required_release_bundles) == 1:
        try:
            receipt_ref, receipt_digest = production_image_binding_from_claims(
                required_release_bundles[0].claims
            )
            state_ref, state_digest = production_image_binding_from_state(state)
            image_binding_ready = bool(
                hmac.compare_digest(receipt_ref, state_ref)
                and hmac.compare_digest(receipt_digest, state_digest)
            )
            if image_binding_ready:
                required_image_ref = state_ref
                required_image_digest = state_digest
        except ValueError:
            image_binding_ready = False
    acked_messages = [
        row for row in relevant_messages
        if _is_bound_release_approval(
            row,
            state,
            target_stage=target,
            valid_receipts=valid_receipts_by_id,
            required_artifact_hashes=required_artifact_hashes,
            required_image_ref=required_image_ref,
            required_image_digest=required_image_digest,
        )
    ]
    invalid_evidence_ids: List[str] = []
    for row in relevant_messages:
        ack = row.ack_receipt if isinstance(row.ack_receipt, dict) else {}
        result = ack.get("result_receipt") if isinstance(ack.get("result_receipt"), dict) else {}
        evidence_ids = _dedupe_rows([str(value) for value in result.get("evidence_receipts") or []])
        unknown_ids = [value for value in evidence_ids if value not in valid_receipts_by_id]
        invalid_evidence_ids.extend(unknown_ids)
        resolved = [valid_receipts_by_id[value] for value in evidence_ids if value in valid_receipts_by_id]
        if resolved and not any(
            _canary_evidence_satisfies_stage(
                receipt,
                target_stage=target,
                required_artifact_hashes=required_artifact_hashes,
                required_image_ref=required_image_ref,
                required_image_digest=required_image_digest,
            )
            for receipt in resolved
        ):
            invalid_evidence_ids.extend(evidence_ids)
    invalid_evidence_receipt_ids = sorted(set(invalid_evidence_ids))

    dependability_success = bool((dependability_report or {}).get("success")) if require_dependability else True
    checks = {
        "revision_aligned": state.revision_id == shared_state.revision_id,
        "lifecycle_ready": snapshot.lifecycle_state in allowed_lifecycle,
        "dependability_ok": dependability_success,
        "handoff_receipts_ok": len(acked_messages) >= int(required_handoff_count or 0),
        # Only current, fully bound handoffs enter tracked_message_ids and can
        # satisfy handoff_receipts_ok. Historical stale records remain audit
        # evidence but do not permanently poison a later valid promotion.
        "handoff_bindings_current": True,
        "dead_letters_clear": len(dead_letter_messages) == 0,
        "lease_health_ok": len(stale_leases) == 0,
        "active_leases_safe": len(unexpected_active_leases) == 0,
        "fenceposts_ready": len(missing_fenceposts) == 0,
        "artifacts_ready": len(missing_artifacts) == 0,
        "image_digest_ready": image_binding_ready,
        "operator_holds_clear": len(state.operator_holds) == 0,
    }
    safe_push = all(checks.values())

    blockers: List[Dict[str, Any]] = []
    if not checks["revision_aligned"]:
        blockers.append(
            {
                "check": "revision_aligned",
                "summary": f"release revision drifted: state={state.revision_id}, shared={shared_state.revision_id}",
            }
        )
    if not checks["lifecycle_ready"]:
        blockers.append(
            {
                "check": "lifecycle_ready",
                "summary": f"snapshot lifecycle {snapshot.lifecycle_state} is not promotion-safe",
            }
        )
    if not checks["dependability_ok"]:
        blockers.append(
            {
                "check": "dependability_ok",
                "summary": f"dependability report failed for promotion to {target}",
            }
        )
    if not checks["handoff_receipts_ok"]:
        blockers.append(
            {
                "check": "handoff_receipts_ok",
                "summary": f"acked handoffs {len(acked_messages)} below required {int(required_handoff_count or 0)}",
                "invalid_evidence_receipt_ids": invalid_evidence_receipt_ids,
            }
        )
    if not checks["dead_letters_clear"]:
        blockers.append(
            {
                "check": "dead_letters_clear",
                "summary": f"{len(dead_letter_messages)} dead-letter handoffs still need recovery",
                "message_ids": [row.message_id for row in dead_letter_messages],
            }
        )
    if not checks["lease_health_ok"]:
        blockers.append(
            {
                "check": "lease_health_ok",
                "summary": f"{len(stale_leases)} stale agent leases block safe push",
                "lease_ids": [row.lease_id for row in stale_leases],
            }
        )
    if not checks["active_leases_safe"]:
        blockers.append(
            {
                "check": "active_leases_safe",
                "summary": f"{len(unexpected_active_leases)} active leases still own release scope",
                "lease_ids": [row.lease_id for row in unexpected_active_leases],
            }
        )
    if not checks["fenceposts_ready"]:
        blockers.append(
            {
                "check": "fenceposts_ready",
                "summary": f"missing rollback fenceposts: {', '.join(missing_fenceposts)}",
                "missing_fenceposts": missing_fenceposts,
            }
        )
    if not checks["artifacts_ready"]:
        blockers.append(
            {
                "check": "artifacts_ready",
                "summary": f"missing current candidate-bound artifact receipts: {', '.join(missing_artifacts)}",
                "missing_artifacts": missing_artifacts,
                "invalid_receipt_ids": invalid_artifact_receipts,
            }
        )
    if not checks["image_digest_ready"]:
        blockers.append(
            {
                "check": "image_digest_ready",
                "summary": "release bundle lacks the immutable published production image binding",
            }
        )
    if not checks["operator_holds_clear"]:
        blockers.append(
            {
                "check": "operator_holds_clear",
                "summary": f"operator holds active: {', '.join(state.operator_holds)}",
            }
        )

    return {
        "process_id": state.process_id,
        "release_id": state.release_id,
        "candidate_ref": state.candidate_ref,
        "current_stage": state.current_stage,
        "target_stage": target,
        "current_revision_id": shared_state.revision_id,
        "checks": checks,
        "safe_push": safe_push,
        "required_fencepost_stages": required_fenceposts,
        "required_artifacts": required_artifact_ids,
        "required_handoff_count": int(required_handoff_count or 0),
        "allowed_active_agents": sorted(allowed_agents),
        "allowed_lifecycle_states": allowed_lifecycle,
        "require_dependability": bool(require_dependability),
        "counts": {
            "tracked_handoff_count": len(tracked_message_ids),
            "acked_handoff_count": len(acked_messages),
            "dead_letter_count": len(dead_letter_messages),
            "active_lease_count": len(active_leases),
            "stale_lease_count": len(stale_leases),
            "rollback_fencepost_count": len(state.rollback_fenceposts),
            "stale_handoff_record_count": len(stale_handoff_records),
        },
        "missing_fenceposts": missing_fenceposts,
        "missing_artifacts": missing_artifacts,
        "valid_artifact_receipt_ids": sorted(present_artifacts),
        "invalid_artifact_receipt_ids": invalid_artifact_receipts,
        "invalid_evidence_receipt_ids": invalid_evidence_receipt_ids,
        "production_image_ref": required_image_ref or None,
        "production_image_digest": required_image_digest or None,
        "dead_letter_ids": [row.message_id for row in dead_letter_messages],
        "acked_handoff_ids": [row.message_id for row in acked_messages],
        "stale_handoff_records": [dict(row) for row in stale_handoff_records],
        "dependability": dict(dependability_report or {}),
        "blockers": blockers,
        "operator_summary": (
            f"release promotion {'ready' if safe_push else 'blocked'} for {state.process_id}: "
            f"stage {state.current_stage} -> {target}, blockers={len(blockers)}"
        ),
    }



def _apply_gate_result(state: ReleaseWorkflowState, gate: JsonDict) -> ReleaseWorkflowState:
    return _copy_state(
        state,
        revision_id=str(gate.get("current_revision_id") or state.revision_id).strip() or state.revision_id,
        status="ready" if bool(gate.get("safe_push")) else "blocked",
        safe_push_criteria=dict(gate or {}),
        updated_at=_now_iso(),
    )



def advance_release_workflow(
    state: ReleaseWorkflowState,
    *,
    gate: JsonDict,
    next_stage: str,
    actor: str,
    dry_run: bool = False,
    metadata: Optional[Dict[str, Any]] = None,
) -> JsonDict:
    target = str(next_stage or "").strip()
    if not target:
        raise ValueError("next_stage must be non-empty")
    actor_id = str(actor or "").strip()
    if not actor_id:
        raise ValueError("actor must be non-empty")
    try:
        current_index = RELEASE_STAGE_TOPOLOGY.index(state.current_stage)
    except ValueError as exc:
        raise ValueError(f"release stage is outside the immutable topology: {state.current_stage}") from exc
    if state.target_environment != RELEASE_STAGE_TOPOLOGY[-1]:
        raise ValueError("release workflow target must be production")
    expected_target = (
        RELEASE_STAGE_TOPOLOGY[current_index + 1]
        if current_index + 1 < len(RELEASE_STAGE_TOPOLOGY)
        else None
    )
    if target != expected_target:
        raise ValueError(
            f"release transition must follow immutable topology: {state.current_stage} -> {expected_target}"
        )
    gate_target = str(gate.get("target_stage") or "").strip()
    if gate_target and gate_target != target:
        raise ValueError("promotion gate is not bound to the requested next stage")

    gated_state = _apply_gate_result(state, gate)
    if not bool(gate.get("safe_push")) or dry_run:
        return {
            "promoted": False,
            "dry_run": bool(dry_run),
            "blocked_reason": None if dry_run else "promotion_gate_failed",
            "state": gated_state,
            "previous_stage": state.current_stage,
            "next_stage": target,
            "operator_summary": (
                f"release promotion preview for {state.process_id}: {state.current_stage} -> {target}"
                if dry_run
                else f"release promotion blocked for {state.process_id}: {state.current_stage} -> {target}"
            ),
        }

    promotion_entry = {
        "ts": _now_iso(),
        "actor": actor_id,
        "from_stage": state.current_stage,
        "to_stage": target,
        "safe_push": True,
        "candidate_ref": state.candidate_ref,
        "production_image_ref": gate.get("production_image_ref"),
        "production_image_digest": gate.get("production_image_digest"),
        "metadata": dict(metadata or {}),
    }
    updated = _copy_state(
        gated_state,
        current_stage=target,
        status="promoted" if target == state.target_environment else "in_progress",
        promotion_history=list(gated_state.promotion_history) + [promotion_entry],
        updated_at=_now_iso(),
    )
    return {
        "promoted": True,
        "dry_run": False,
        "blocked_reason": None,
        "state": updated,
        "previous_stage": state.current_stage,
        "next_stage": target,
        "operator_summary": f"release promoted for {state.process_id}: {state.current_stage} -> {target}",
    }



def rollback_release_workflow(
    state: ReleaseWorkflowState,
    *,
    stage: Optional[str] = None,
    fencepost_id: Optional[str] = None,
    actor: str = "operator",
    reason: str = "rollback",
) -> JsonDict:
    if not state.rollback_fenceposts:
        raise KeyError(f"release workflow has no rollback fenceposts: {state.process_id}")

    stage_ranks = {name: index for index, name in enumerate(RELEASE_STAGE_TOPOLOGY)}
    current_rank = stage_ranks.get(state.current_stage)
    if current_rank is None:
        raise ValueError(f"release stage is outside the immutable rollback topology: {state.current_stage}")

    def _strictly_prior(row: ReleaseRollbackFencepost) -> bool:
        row_rank = stage_ranks.get(row.stage)
        return row_rank is not None and row_rank < current_rank

    target: Optional[ReleaseRollbackFencepost] = None
    if fencepost_id:
        target_id = str(fencepost_id or "").strip()
        for row in reversed(state.rollback_fenceposts):
            if row.fencepost_id == target_id:
                target = row
                break
    elif stage:
        stage_name = str(stage or "").strip()
        for row in reversed(state.rollback_fenceposts):
            if row.stage == stage_name:
                target = row
                break
    else:
        eligible = [row for row in state.rollback_fenceposts if _strictly_prior(row)]
        if eligible:
            target = max(eligible, key=lambda row: (stage_ranks[row.stage], row.created_at))

    if target is None:
        selector = fencepost_id or stage or "prior_stage"
        raise KeyError(f"rollback fencepost not found for {state.process_id}: {selector}")
    if not _strictly_prior(target):
        raise ValueError(
            f"rollback target must strictly precede {state.current_stage} in the immutable release topology: {target.stage}"
        )

    rollback_image_ref = str(target.image_ref or "").strip()
    rollback_image_digest = str(target.image_digest or "").strip()
    active_image_ref = str((state.metadata or {}).get("production_image_ref") or "").strip()
    active_image_digest = str((state.metadata or {}).get("production_image_digest") or "").strip()
    if active_image_ref or active_image_digest:
        normalize_production_image_binding(
            image_ref=active_image_ref,
            image_digest=active_image_digest,
        )
        rollback_image_ref, rollback_image_digest = normalize_production_image_binding(
            image_ref=rollback_image_ref,
            image_digest=rollback_image_digest,
        )
    rollback_command = (
        operator_rollback_command(rollback_image_ref, rollback_image_digest)
        if rollback_image_ref and rollback_image_digest
        else None
    )

    target_rank = stage_ranks[target.stage]
    retained_fenceposts = [
        row for row in state.rollback_fenceposts
        if stage_ranks.get(row.stage, len(RELEASE_STAGE_TOPOLOGY)) <= target_rank
    ]

    rollback_entry = {
        "ts": _now_iso(),
        "actor": str(actor or "operator").strip() or "operator",
        "action": "rollback",
        "reason": str(reason or "rollback").strip() or "rollback",
        "target_stage": target.stage,
        "fencepost_id": target.fencepost_id,
        "production_image_ref": rollback_image_ref or None,
        "production_image_digest": rollback_image_digest or None,
    }
    updated = _copy_state(
        state,
        current_stage=target.stage,
        status="rolled_back",
        revision_id=target.shared_state_revision_id,
        promotion_history=list(state.promotion_history) + [rollback_entry],
        rollback_fenceposts=retained_fenceposts,
        safe_push_criteria={
            "safe_push": False,
            "rollback_target_stage": target.stage,
            "rollback_fencepost_id": target.fencepost_id,
        },
        metadata={
            **dict(state.metadata),
            "rollback_target_stage": target.stage,
            "rollback_fencepost_id": target.fencepost_id,
            "rollback_reason": str(reason or "rollback").strip() or "rollback",
            "production_image_ref": rollback_image_ref or None,
            "production_image_digest": rollback_image_digest or None,
            "operator_rollback_command": rollback_command,
        },
        updated_at=_now_iso(),
    )
    return {
        "rolled_back": True,
        "state": updated,
        "fencepost": target.model_dump() if hasattr(target, "model_dump") else target.dict(),
        "restore_state": dict(target.restore_state or {}),
        "production_image_ref": rollback_image_ref or None,
        "production_image_digest": rollback_image_digest or None,
        "operator_rollback_command": rollback_command,
        "operator_summary": f"release rolled back for {state.process_id} to {target.stage}",
    }



def compile_release_repair_plan(state: ReleaseWorkflowState, gate: JsonDict) -> JsonDict:
    checks = dict(gate.get("checks") or {})
    actions: List[JsonDict] = []

    def _add(check: str, action: str, detail: str) -> None:
        actions.append({"check": check, "action": action, "detail": detail})

    if not checks.get("revision_aligned", True):
        _add("revision_aligned", "refresh_release_revision", "align the release workflow revision with the shared process head")
    if not checks.get("handoff_receipts_ok", True) or not checks.get("dead_letters_clear", True) or not checks.get("handoff_bindings_current", True):
        _add("handoff_receipts_ok", "recover_handoff_messages", "requeue stale or dead-letter handoffs for recipient verification on the current revision")
    if not checks.get("lease_health_ok", True):
        _add("lease_health_ok", "resolve_stale_leases", "reclaim stale leases and release them before promotion")
    if not checks.get("active_leases_safe", True):
        _add("active_leases_safe", "manual_scope_drain", "drain or explicitly allow active leases before promoting the release")
    if not checks.get("fenceposts_ready", True):
        _add("fenceposts_ready", "restore_archived_fenceposts", "restore revision-matched fenceposts captured when each required stage was reached")
    if not checks.get("artifacts_ready", True):
        _add("artifacts_ready", "regenerate_release_artifacts", "regenerate missing build or smoke-test artifacts before promotion")
    if not checks.get("dependability_ok", True):
        _add("dependability_ok", "revalidate_dependability", "re-run the dependability checks and checkpoint the runtime before promotion")
    if not checks.get("lifecycle_ready", True):
        _add("lifecycle_ready", "restore_safe_lifecycle_state", "move the process back to a waiting or completed state before promoting")
    if not checks.get("operator_holds_clear", True):
        _add("operator_holds_clear", "manual_hold_clear", "clear operator holds explicitly before pushing the release")

    deduped: List[JsonDict] = []
    seen = set()
    for row in actions:
        key = (row["action"], row["detail"])
        if key in seen:
            continue
        seen.add(key)
        deduped.append(row)

    return {
        "process_id": state.process_id,
        "release_id": state.release_id,
        "failing_checks": [name for name, passed in checks.items() if not passed],
        "actions": deduped,
        "operator_summary": f"release repair plan: {len(deduped)} actions for {state.process_id}",
    }



def repair_release_workflow(
    state: ReleaseWorkflowState,
    *,
    snapshot: ProcessSnapshot,
    shared_state: SharedProcessState,
    mailbox: AgentMailbox,
    supervisor: AgentSupervisor,
    gate: Optional[JsonDict] = None,
    target_stage: Optional[str] = None,
    dependability_report: Optional[JsonDict] = None,
    required_fencepost_stages: Optional[List[str]] = None,
    required_artifacts: Optional[List[str]] = None,
    required_handoff_count: Optional[int] = None,
    allowed_active_agents: Optional[List[str]] = None,
    allowed_lifecycle_states: Optional[List[str]] = None,
    require_dependability: Optional[bool] = None,
    artifact_store: Optional[ReleaseArtifactStore] = None,
    verifier_credentials: Optional[Dict[str, Any]] = None,
) -> JsonDict:
    stage_target = str(target_stage or (gate or {}).get("target_stage") or state.target_environment).strip()
    if not stage_target:
        raise ValueError("target_stage must be non-empty for release repair")

    active_gate = gate or evaluate_release_promotion_gate(
        state=state,
        snapshot=snapshot,
        shared_state=shared_state,
        target_stage=stage_target,
        mailbox_messages=mailbox.list(process_id=state.process_id),
        leases=supervisor.list(process_id=state.process_id),
        dependability_report=dependability_report,
        required_fencepost_stages=required_fencepost_stages,
        required_artifacts=required_artifacts,
        required_handoff_count=int(required_handoff_count or 0),
        allowed_active_agents=allowed_active_agents,
        allowed_lifecycle_states=allowed_lifecycle_states,
        require_dependability=bool(require_dependability) if require_dependability is not None else bool((gate or {}).get("require_dependability", True)),
        artifact_store=artifact_store,
        verifier_credentials=verifier_credentials,
    )

    updated_state = _apply_gate_result(state, active_gate)
    actions_taken: List[JsonDict] = []

    if not active_gate["checks"].get("revision_aligned", True):
        updated_state = _copy_state(updated_state, revision_id=shared_state.revision_id, updated_at=_now_iso())
        actions_taken.append({"action": "refresh_release_revision", "revision_id": shared_state.revision_id})

    relevant_messages = mailbox.list(process_id=state.process_id)
    tracked_ids = {
        str(row.get("message_id") or "").strip()
        for row in updated_state.handoff_records
        if str(row.get("message_id") or "").strip() and str(row.get("stage") or "").strip() == stage_target
    }
    relevant_messages = [row for row in relevant_messages if row.message_id in tracked_ids]

    recovered_ids: List[str] = []
    for row in relevant_messages:
        if row.delivery_status == "dead_letter":
            recovered = mailbox.recover_dead_letter(
                row.message_id,
                revision_id=shared_state.revision_id,
                recovery_reason="release_gate_repair",
            )
            recovered_ids.append(recovered.message_id)
            row = recovered
        latest_messages = {msg.message_id: msg for msg in mailbox.list(process_id=state.process_id)}
        latest = latest_messages.get(row.message_id)
        if latest is not None:
            updated_state = record_release_handoff(updated_state, latest, stage=stage_target, notes="requeued for recipient verification")
    if recovered_ids:
        actions_taken.append(
            {
                "action": "recover_handoff_messages",
                "recovered_ids": recovered_ids,
            }
        )

    if not active_gate["checks"].get("lease_health_ok", True):
        reclaimed = supervisor.reclaim_stale(process_id=state.process_id)
        actions_taken.append(
            {
                "action": "stale_leases_require_fenced_takeover",
                "reclaimed_ids": [row.lease_id for row in reclaimed],
                "stale_ids": [row.lease_id for row in supervisor.list(process_id=state.process_id, status="stale")],
                "blocking": True,
            }
        )

    missing_fenceposts = list(active_gate.get("missing_fenceposts") or [])
    if missing_fenceposts:
        actions_taken.append(
            {
                "action": "missing_historical_fenceposts",
                "stages": missing_fenceposts,
                "blocking": True,
            }
        )

    refreshed_gate = evaluate_release_promotion_gate(
        state=updated_state,
        snapshot=snapshot,
        shared_state=shared_state,
        target_stage=stage_target,
        mailbox_messages=mailbox.list(process_id=state.process_id),
        leases=supervisor.list(process_id=state.process_id),
        dependability_report=dependability_report,
        required_fencepost_stages=required_fencepost_stages or list(active_gate.get("required_fencepost_stages") or []),
        required_artifacts=required_artifacts or list(active_gate.get("required_artifacts") or []),
        required_handoff_count=int(active_gate.get("required_handoff_count", required_handoff_count or 0) or 0),
        allowed_active_agents=allowed_active_agents or list(active_gate.get("allowed_active_agents") or []),
        allowed_lifecycle_states=allowed_lifecycle_states or list(active_gate.get("allowed_lifecycle_states") or []),
        require_dependability=bool(require_dependability) if require_dependability is not None else bool(active_gate.get("require_dependability", True)),
        artifact_store=artifact_store,
        verifier_credentials=verifier_credentials,
    )
    updated_state = _apply_gate_result(updated_state, refreshed_gate)

    return {
        "state": updated_state,
        "gate_before": active_gate,
        "gate_after": refreshed_gate,
        "actions_taken": actions_taken,
        "success": bool(refreshed_gate.get("safe_push")),
        "operator_summary": (
            f"release repair {'ok' if refreshed_gate.get('safe_push') else 'failed'} for {state.process_id}: "
            f"actions={len(actions_taken)}"
        ),
    }



def _restore_release_session_registry(session_registry: Any, *, process_id: str, session_state: Dict[str, Any]) -> None:
    if session_registry is None or "sessions" not in session_state:
        return
    restored_rows = []
    for row in session_state.get("sessions") or []:
        if not isinstance(row, dict) or str(row.get("process_id") or "").strip() != process_id:
            continue
        restored_rows.append(SessionRecord.model_validate(row) if hasattr(SessionRecord, "model_validate") else SessionRecord.parse_obj(row))
    with session_registry._transaction():
        retained = [row for row in session_registry._load_all() if row.process_id != process_id]
        session_registry._write_all(retained + restored_rows)


def _restore_release_watchers(watcher_store: Any, *, process_id: str, session_state: Dict[str, Any]) -> None:
    if watcher_store is None or "watchers" not in session_state:
        return
    restored_rows = [
        row
        for row in (session_state.get("watchers") or [])
        if isinstance(row, dict) and str(row.get("process_id") or "").strip() == process_id
    ]
    watcher_store.replace_process(process_id=process_id, registrations=restored_rows)


def _rollback_request_fingerprint(
    *,
    process_id: str,
    release_id: str,
    stage: Optional[str],
    fencepost_id: Optional[str],
    actor: Optional[str],
    reason: str,
    required_projections: Optional[Sequence[str]],
) -> str:
    canonical = json.dumps(
        {
            "version": "cortex.release-rollback-request.v1",
            "process_id": str(process_id),
            "release_id": str(release_id),
            "stage": str(stage or "").strip() or None,
            "fencepost_id": str(fencepost_id or "").strip() or None,
            "actor": str(actor or "").strip() or None,
            "reason": str(reason or "rollback").strip() or "rollback",
            "required_projections": sorted(_dedupe_rows(list(required_projections or []))),
        },
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return f"sha256:{hashlib.sha256(canonical).hexdigest()}"


def _rollback_bundle_parts(payload: Dict[str, Any]) -> tuple[ReleaseWorkflowState, Dict[str, Any], Dict[str, Any]]:
    bundle = payload.get("rollback_bundle")
    if not isinstance(bundle, dict) and isinstance(payload.get("rolled_state"), dict):
        # Read compatibility for an intent published by the immediately prior
        # release. It is normalized and republished before recovery continues.
        target = dict(payload.get("fencepost") or {})
        return (
            _workflow_validate_compat(dict(payload["rolled_state"])),
            target,
            dict(payload.get("restore_state") or target.get("restore_state") or {}),
        )
    if not isinstance(bundle, dict) or bundle.get("version") != "cortex.release-rollback-bundle.v1":
        raise RuntimeError("rollback transaction is missing its normalized restore bundle")
    rolled_state = _workflow_validate_compat(dict(bundle.get("rolled_state") or {}))
    selected_id = str(bundle.get("selected_fencepost_id") or "").strip()
    target = next(
        (
            row.model_dump() if hasattr(row, "model_dump") else row.dict()
            for row in rolled_state.rollback_fenceposts
            if row.fencepost_id == selected_id
        ),
        None,
    )
    if target is None:
        raise RuntimeError("rollback restore bundle does not contain its selected fencepost")
    return rolled_state, target, dict(target.get("restore_state") or {})


def _committed_rollback_descriptor(response: Dict[str, Any]) -> Dict[str, Any]:
    state = response["state"]
    snapshot = response["snapshot"]
    shared_state = response["shared_state"]
    rollback_event = response.get("rollback_event")
    transaction = response["rollback_transaction"]
    return {
        "version": "cortex.release-rollback-committed.v1",
        "transaction_id": str(transaction.get("transaction_id") or ""),
        "release_persistence_revision": int(getattr(state, "persistence_revision", 0) or 0),
        "state_revision_id": str(getattr(state, "revision_id", "") or ""),
        "snapshot_id": str(getattr(snapshot, "snapshot_id", "") or ""),
        "snapshot_persistence_revision": int(getattr(snapshot, "persistence_revision", 0) or 0),
        "shared_state_revision_id": str(getattr(shared_state, "revision_id", "") or ""),
        "rollback_event_id": str((rollback_event or {}).get("event_id") or "") if isinstance(rollback_event, dict) else "",
        "completed_projections": list(transaction.get("completed_projections") or []),
        "applied": bool(response.get("applied")),
        "production_image_ref": str(response.get("production_image_ref") or "") or None,
        "production_image_digest": str(response.get("production_image_digest") or "") or None,
        "operator_rollback_command": str(response.get("operator_rollback_command") or "") or None,
        "operator_summary": str(response.get("operator_summary") or ""),
    }


def _restore_committed_rollback_response(
    payload: Dict[str, Any],
    *,
    intent: Optional[Dict[str, Any]] = None,
    release_store: Optional[ReleaseWorkflowStore] = None,
    snapshot_store: Optional[ProcessSnapshotStore] = None,
    shared_state_store: Optional[SharedProcessStateStore] = None,
    journal: Optional[ProcessJournal] = None,
) -> JsonDict:
    if payload.get("version") == "cortex.release-rollback-committed.v1":
        bundle_source = intent if isinstance((intent or {}).get("rollback_bundle"), dict) else payload
        rolled_state, target_fencepost, restore_state = _rollback_bundle_parts(bundle_source)
        state = release_store.load(rolled_state.process_id) if release_store is not None else rolled_state
        snapshot = snapshot_store.load(rolled_state.process_id) if snapshot_store is not None else None
        shared_state = shared_state_store.load(rolled_state.process_id) if shared_state_store is not None else None
        if state is None or snapshot is None or shared_state is None:
            raise RuntimeError("committed rollback references unavailable durable state")
        transaction_id = str(payload.get("transaction_id") or "")
        if (
            str((state.metadata or {}).get("rollback_transaction_id") or "") != transaction_id
            or str((snapshot.metadata or {}).get("rollback_transaction_id") or "") != transaction_id
            or str((shared_state.metadata or {}).get("rollback_transaction_id") or "") != transaction_id
        ):
            raise RuntimeError("committed rollback references no longer identify the active durable state")
        rollback_event = None
        event_id = str(payload.get("rollback_event_id") or "")
        if journal is not None and event_id:
            rollback_event = next(
                (row for row in journal.load(process_id=rolled_state.process_id) if row.event_id == event_id),
                None,
            )
        return {
            "rolled_back": True,
            "state": state,
            "fencepost": target_fencepost,
            "restore_state": restore_state,
            "snapshot": snapshot,
            "shared_state": shared_state,
            "rollback_event": (
                rollback_event.model_dump() if hasattr(rollback_event, "model_dump")
                else rollback_event.dict() if rollback_event is not None else None
            ),
            "rollback_transaction": dict(intent or payload),
            "rollback_projections": {},
            "applied": bool(payload.get("applied")),
            "production_image_ref": payload.get("production_image_ref"),
            "production_image_digest": payload.get("production_image_digest"),
            "operator_rollback_command": payload.get("operator_rollback_command"),
            "operator_summary": str(payload.get("operator_summary") or ""),
        }
    response = dict(payload)
    response["state"] = _workflow_validate_compat(dict(response["state"]))
    response["snapshot"] = (
        ProcessSnapshot.model_validate(dict(response["snapshot"]))
        if hasattr(ProcessSnapshot, "model_validate")
        else ProcessSnapshot.parse_obj(dict(response["snapshot"]))
    )
    response["shared_state"] = (
        SharedProcessState.model_validate(dict(response["shared_state"]))
        if hasattr(SharedProcessState, "model_validate")
        else SharedProcessState.parse_obj(dict(response["shared_state"]))
    )
    if intent is not None:
        response["rollback_transaction"] = dict(intent)
    return response


def apply_release_rollback_restore(
    state: ReleaseWorkflowState,
    *,
    snapshot_store: ProcessSnapshotStore,
    shared_state_store: SharedProcessStateStore,
    release_store: Optional[ReleaseWorkflowStore] = None,
    journal: Optional[ProcessJournal] = None,
    session_registry: Any = None,
    watcher_store: Any = None,
    stage: Optional[str] = None,
    fencepost_id: Optional[str] = None,
    actor: Optional[str] = None,
    reason: str = "rollback",
    new_revision_id: Optional[str] = None,
    required_projections: Optional[Sequence[str]] = None,
    projection_callback: Optional[Callable[..., Dict[str, Any]]] = None,
    idempotency_key: Optional[str] = None,
) -> JsonDict:
    transaction_store = release_store or ReleaseWorkflowStore(Path(snapshot_store.path).parent / "rollback_transactions")
    normalized_reason = str(reason or "rollback").strip() or "rollback"
    if str(new_revision_id or "").strip():
        raise ValueError("rollback revision identifiers are assigned by the server")
    # Keep the authoritative snapshot fenced for the complete rollback core.
    # Session ingestion uses the same per-process transaction, so it can only
    # apply session-only changes to the fully restored snapshot after commit.
    with (
        transaction_store.rollback_transaction(state.process_id),
        shared_state_store.transaction(state.process_id),
        snapshot_store.transaction(state.process_id),
    ):
        if release_store is not None:
            authoritative_state = release_store.load(state.process_id)
            if authoritative_state is None:
                raise KeyError(f"release workflow not found: {state.process_id}")
            if authoritative_state.release_id != state.release_id:
                raise RuntimeError(
                    f"release workflow identity changed for {state.process_id}: "
                    f"stored={authoritative_state.release_id}, requested={state.release_id}"
                )
            # The endpoint may have read state while a promotion owned the
            # release transaction. Rebase rollback planning on the state that
            # is authoritative after acquiring the same transaction fence.
            state = authoritative_state
        intent = transaction_store.load_rollback_intent(state.process_id)
        requested_idempotency_key = str(idempotency_key or "").strip()
        caller_supplied_idempotency_key = bool(requested_idempotency_key)
        if len(requested_idempotency_key) > 256:
            raise ValueError("rollback idempotency key exceeds 256 characters")
        if (
            not requested_idempotency_key
            and intent
            and intent.get("status") in {"in_progress", "recovery_required"}
        ):
            requested_idempotency_key = str(intent.get("idempotency_key") or "").strip()
        if not requested_idempotency_key:
            requested_idempotency_key = f"internal-{uuid4().hex}"
        implicit_recovery = bool(
            not caller_supplied_idempotency_key
            and intent
            and intent.get("status") in {"in_progress", "recovery_required"}
            and str(intent.get("idempotency_key") or "") == requested_idempotency_key
        )
        request_fingerprint = (
            str(intent.get("request_fingerprint") or "")
            if implicit_recovery
            else _rollback_request_fingerprint(
                process_id=state.process_id,
                release_id=state.release_id,
                stage=stage,
                fencepost_id=fencepost_id,
                actor=actor,
                reason=normalized_reason,
                required_projections=required_projections,
            )
        )

        archived_result = transaction_store.load_rollback_result(
            state.process_id,
            requested_idempotency_key,
        )
        if archived_result is not None:
            if str(archived_result.get("request_fingerprint") or "") != request_fingerprint:
                raise ValueError("rollback idempotency key was reused with a different request")
            return _restore_committed_rollback_response(
                dict(archived_result["committed_response"]),
                release_store=release_store,
                snapshot_store=snapshot_store,
                shared_state_store=shared_state_store,
                journal=journal,
            )

        same_intent_key = bool(
            intent
            and str(intent.get("idempotency_key") or "") == requested_idempotency_key
            and intent.get("release_id") == state.release_id
        )
        if same_intent_key and str(intent.get("request_fingerprint") or "") != request_fingerprint:
            raise ValueError("rollback idempotency key was reused with a different request")
        if same_intent_key and intent.get("status") == "committed":
            committed_response = intent.get("committed_response")
            if not isinstance(committed_response, dict):
                raise RuntimeError("committed rollback intent is missing its response")
            return _restore_committed_rollback_response(
                committed_response,
                intent=intent,
                release_store=release_store,
                snapshot_store=snapshot_store,
                shared_state_store=shared_state_store,
                journal=journal,
            )
        if intent and not same_intent_key and intent.get("status") in {"in_progress", "recovery_required"}:
            raise RuntimeError("a different rollback idempotency key owns pending recovery")
        if intent and not same_intent_key and intent.get("status") == "committed":
            previous_response = intent.get("committed_response")
            if isinstance(previous_response, dict) and intent.get("idempotency_key"):
                transaction_store.save_rollback_result(
                    state.process_id,
                    idempotency_key=str(intent["idempotency_key"]),
                    request_fingerprint=str(intent.get("request_fingerprint") or ""),
                    committed_response={
                        **previous_response,
                        "rollback_bundle": dict(intent.get("rollback_bundle") or {}),
                    },
                )
            if not str(stage or "").strip() and not str(fencepost_id or "").strip():
                raise ValueError(
                    "a distinct rollback requires a new idempotency key and an explicit target"
                )

        resumable = bool(
            same_intent_key
            and intent
            and intent.get("status") in {"in_progress", "recovery_required"}
        )
        if resumable:
            rolled_state, target_fencepost, restore_state = _rollback_bundle_parts(intent)
            if not isinstance(intent.get("rollback_bundle"), dict):
                intent = transaction_store.save_rollback_intent(
                    state.process_id,
                    {
                        **{
                            key: value
                            for key, value in intent.items()
                            if key not in {"source_release_state", "rolled_state", "fencepost", "restore_state"}
                        },
                        "selected_fencepost_id": str(target_fencepost.get("fencepost_id") or ""),
                        "rollback_bundle": {
                            "version": "cortex.release-rollback-bundle.v1",
                            "selected_fencepost_id": str(target_fencepost.get("fencepost_id") or ""),
                            "rolled_state": _workflow_dump_compat(rolled_state),
                        },
                    },
                )
        else:
            rolled = rollback_release_workflow(state, stage=stage, fencepost_id=fencepost_id, reason=normalized_reason)
            rolled_state = rolled["state"]
            target_fencepost = dict(rolled["fencepost"])
            restore_state = dict(rolled.get("restore_state") or {})
            transaction_id = f"rollback_{uuid4().hex[:16]}"
            target_revision = str(restore_state.get("shared_state_revision_id") or target_fencepost.get("shared_state_revision_id") or "").strip()
            if not target_revision:
                raise ValueError("rollback fencepost missing shared_state_revision_id")
            intent = transaction_store.save_rollback_intent(
                state.process_id,
                {
                    "transaction_id": transaction_id,
                    "status": "in_progress",
                    "phase": "planned",
                    "idempotency_key": requested_idempotency_key,
                    "request_fingerprint": request_fingerprint,
                    "release_id": state.release_id,
                    "source_stage": state.current_stage,
                    "source_revision_id": state.revision_id,
                    "canonical_request": {
                        "stage": str(stage or "").strip() or None,
                        "fencepost_id": str(fencepost_id or "").strip() or None,
                        "actor": str(actor or "").strip() or None,
                        "reason": normalized_reason,
                        "required_projections": _dedupe_rows(list(required_projections or [])),
                    },
                    "target_revision_id": target_revision,
                    "restored_artifact_revision_id": target_revision,
                    # Preserve the established rollback revision type suffix
                    # while retaining a server-assigned, transaction-unique
                    # identifier that callers cannot choose or collide with.
                    "rollback_revision_id": f"{transaction_id}_{uuid4().hex[:12]}.rollback",
                    "rollback_event_id": f"evt_{transaction_id}",
                    "rollback_snapshot_id": f"snap_{transaction_id}",
                    "reason": normalized_reason,
                    "actor": str(actor or "").strip() or None,
                    "selected_fencepost_id": str(target_fencepost.get("fencepost_id") or ""),
                    "rollback_bundle": {
                        "version": "cortex.release-rollback-bundle.v1",
                        "selected_fencepost_id": str(target_fencepost.get("fencepost_id") or ""),
                        "rolled_state": _workflow_dump_compat(rolled_state),
                    },
                    "required_projections": _dedupe_rows(list(required_projections or [])),
                    "completed_projections": [],
                },
            )
            # The committed phase adds only a bounded reference descriptor.
            # Prove that representation fits before restoring any shared state.
            committed_projection = {
                **intent,
                "phase": "committed",
                "status": "committed",
                "committed_response": {
                    "version": "cortex.release-rollback-committed.v1",
                    "transaction_id": transaction_id,
                    "state_revision_id": str(rolled_state.revision_id),
                },
            }
            if len(transaction_store._encoded_json(committed_projection, pretty=True)) > MAX_RUNTIME_DELIVERY_OBJECT_BYTES:
                raise ValueError("committed rollback intent exceeds immutable object quota")

        assert intent is not None
        if resumable:
            normalized_reason = str(intent.get("reason") or normalized_reason).strip() or normalized_reason
            actor = str(intent.get("actor") or actor or "").strip() or None
        transaction_id = str(intent["transaction_id"])
        target_fencepost_id = str(target_fencepost.get("fencepost_id") or "").strip() or None
        target_fencepost_metadata = dict(target_fencepost.get("metadata") or {})
        target_revision_id = str(intent["target_revision_id"])
        rollback_revision_id = str(intent["rollback_revision_id"])
        provenance = {
            "release_id": state.release_id,
            "rollback": True,
            "rollback_transaction_id": transaction_id,
            "fencepost_id": target_fencepost_id,
            "reason": normalized_reason,
        }

        recovery_admission = runtime_delivery_recovery_transaction(
            transaction_store.path.parent,
            process_id=state.process_id,
            transaction_id=transaction_id,
            intent_path=transaction_store._rollback_intent_target(state.process_id),
        )
        recovery_admission.__enter__()
        try:
            current_shared = shared_state_store.load(state.process_id)
            current_provenance_matches = bool(
                current_shared is not None
                and current_shared.revision_id == rollback_revision_id
                and str((current_shared.metadata or {}).get("rollback_transaction_id") or "") == transaction_id
                and str((current_shared.metadata or {}).get("rollback_fencepost_id") or "")
                == str(target_fencepost_id or "")
            )
            if current_provenance_matches:
                restored_shared = current_shared
            else:
                try:
                    restored_shared = shared_state_store.rollback(
                        process_id=state.process_id,
                        to_revision_id=target_revision_id,
                        actor=actor,
                        reason=normalized_reason,
                        new_revision_id=rollback_revision_id,
                        provenance=provenance,
                    )
                except KeyError:
                    restored_shared = shared_state_store.save(
                        SharedProcessState(
                            process_id=state.process_id,
                            revision_id=rollback_revision_id,
                            goals=[str(row) for row in (restore_state.get("goals") or [])],
                            active_plan_node_ids=_dedupe_rows(
                                [str(row) for row in (restore_state.get("active_steps") or [])]
                                + [str(row) for row in (restore_state.get("waiting_steps") or [])]
                            ),
                            open_decisions=list(restore_state.get("open_decisions") or []),
                            runtime_constraints=dict(restore_state.get("runtime_constraints") or {}),
                            world_state=dict(restore_state.get("world_state") or {}),
                            belief_refs=_dedupe_rows([str(row) for row in (restore_state.get("belief_refs") or [])]),
                            open_questions=[str(row) for row in (restore_state.get("open_questions") or [])],
                            agent_ownership=dict(restore_state.get("agent_ownership") or restore_state.get("assigned_agents") or {}),
                            operator_overrides=dict(restore_state.get("operator_overrides") or {}),
                            metadata={
                                "rollback_from_revision_id": current_shared.revision_id if current_shared else None,
                                "rollback_to_revision_id": target_revision_id,
                                "rollback_reason": normalized_reason,
                                "rollback_transaction_id": transaction_id,
                                "rollback_fencepost_id": str(target_fencepost_id or ""),
                            },
                        ),
                        expected_revision_id=current_shared.revision_id if current_shared else None,
                        actor=actor,
                        provenance=provenance,
                    )
            intent = transaction_store.save_rollback_intent(state.process_id, {**intent, "phase": "shared_state_committed", "status": "in_progress"})

            rollback_event = None
            if journal is not None:
                existing_events = {row.event_id: row for row in journal.load(process_id=state.process_id)}
                rollback_event = existing_events.get(str(intent["rollback_event_id"]))
                if rollback_event is None:
                    latest_event = journal.latest(process_id=state.process_id)
                    rollback_event = journal.append(
                        ProcessEvent(
                            event_id=str(intent["rollback_event_id"]),
                            process_id=state.process_id,
                            kind="release_rolled_back",
                            revision_id=restored_shared.revision_id,
                            actor=str(actor or "").strip() or None,
                            causal_parent_ids=[latest_event.event_id] if latest_event else [],
                            payload={
                                "release_id": state.release_id,
                                "from_stage": str(intent.get("source_stage") or state.current_stage),
                                "to_stage": rolled_state.current_stage,
                                "fencepost_id": target_fencepost_id,
                                "reason": normalized_reason,
                                "rollback_transaction_id": transaction_id,
                                "restore_state": json.loads(json.dumps(restore_state)),
                            },
                        )
                    )
            intent = transaction_store.save_rollback_intent(state.process_id, {**intent, "phase": "journal_committed", "status": "in_progress"})

            current_snapshot = snapshot_store.load(state.process_id)
            if current_snapshot is not None and current_snapshot.metadata.get("rollback_transaction_id") == transaction_id:
                restored_snapshot = current_snapshot
            else:
                restored_snapshot = snapshot_store.save(
                    ProcessSnapshot(
                        snapshot_id=str(intent["rollback_snapshot_id"]),
                        process_id=state.process_id,
                        persistence_revision=current_snapshot.persistence_revision if current_snapshot else 0,
                        last_event_id=rollback_event.event_id if rollback_event else restore_state.get("last_event_id"),
                        event_count=max(
                            int(current_snapshot.event_count or 0) if current_snapshot else 0,
                            int(target_fencepost_metadata.get("snapshot_event_count", 0) or 0),
                        ) + (1 if rollback_event else 0),
                        lifecycle_state=str(restore_state.get("lifecycle_state") or "waiting"),
                        active_steps=[str(row) for row in (restore_state.get("active_steps") or []) if str(row).strip()],
                        waiting_steps=[str(row) for row in (restore_state.get("waiting_steps") or []) if str(row).strip()],
                        completed_steps=[str(row) for row in (restore_state.get("completed_steps") or []) if str(row).strip()],
                        failed_steps=[str(row) for row in (restore_state.get("failed_steps") or []) if str(row).strip()],
                        assigned_agents=dict(restore_state.get("assigned_agents") or {}),
                        runtime_policy=dict(restore_state.get("runtime_policy") or {}),
                        session_state=dict(restore_state.get("session_state") or {}),
                        world_state=dict(restore_state.get("world_state") or restored_shared.world_state or {}),
                        belief_refs=_dedupe_rows([str(row) for row in (restore_state.get("belief_refs") or [])] + list(restored_shared.belief_refs)),
                        artifact_refs=[str(row) for row in (restore_state.get("artifact_refs") or []) if str(row).strip()],
                        metadata={
                            **dict(restore_state.get("metadata") or {}),
                            "rollback_applied": True,
                            "rollback_reason": normalized_reason,
                            "rollback_fencepost_id": target_fencepost_id,
                            "rollback_revision_id": restored_shared.revision_id,
                            "rollback_transaction_id": transaction_id,
                        },
                    )
                )
            intent = transaction_store.save_rollback_intent(state.process_id, {**intent, "phase": "snapshot_committed", "status": "in_progress"})

            _restore_release_session_registry(
                session_registry,
                process_id=state.process_id,
                session_state=dict(restore_state.get("session_state") or {}),
            )
            _restore_release_watchers(
                watcher_store,
                process_id=state.process_id,
                session_state=dict(restore_state.get("session_state") or {}),
            )
            intent = transaction_store.save_rollback_intent(state.process_id, {**intent, "phase": "session_registry_committed", "status": "in_progress"})

            applied_state = _copy_state(
                rolled_state,
                revision_id=restored_shared.revision_id,
                metadata={
                    **dict(rolled_state.metadata or {}),
                    "rollback_applied": True,
                    "rollback_reason": normalized_reason,
                    "rollback_fencepost_id": target_fencepost_id,
                    "rollback_revision_id": restored_shared.revision_id,
                    "rollback_transaction_id": transaction_id,
                    "rollback_activation": {
                        "version": "cortex.release.rollback-activation.v1",
                        "transaction_id": transaction_id,
                        "fencepost_id": target_fencepost_id,
                        "stage": rolled_state.current_stage,
                        "artifact_revision_id": str(
                            intent.get("restored_artifact_revision_id") or target_revision_id
                        ),
                        "control_revision_id": restored_shared.revision_id,
                        "production_image_ref": target_fencepost.get("image_ref"),
                        "production_image_digest": target_fencepost.get("image_digest"),
                    },
                },
            )
            if release_store is not None:
                current_release = release_store.load(state.process_id)
                if current_release is not None and current_release.metadata.get("rollback_transaction_id") == transaction_id:
                    applied_state = current_release
                else:
                    applied_state = release_store.save(
                        applied_state,
                        actor=actor,
                        provenance={**provenance, "applied": True, "restored_revision_id": restored_shared.revision_id},
                    )
            intent = transaction_store.save_rollback_intent(
                state.process_id,
                {
                    **intent,
                    "phase": "core_committed",
                    "status": "in_progress",
                    "applied_revision_id": restored_shared.revision_id,
                },
            )
            projection_result: Dict[str, Any] = {}
            required_projection_names = _dedupe_rows(list(intent.get("required_projections") or []))
            if required_projection_names:
                if projection_callback is None:
                    raise RuntimeError(
                        "rollback recovery requires projection callback for: "
                        + ", ".join(required_projection_names)
                    )
                projection_result = dict(
                    projection_callback(
                        applied_state=applied_state,
                        restored_snapshot=restored_snapshot,
                        restored_shared_state=restored_shared,
                        rollback_event=rollback_event,
                        intent=intent,
                    )
                    or {}
                )
                completed_projection_names = _dedupe_rows(
                    list(projection_result.get("completed_projections") or [])
                )
                missing_projection_names = [
                    name for name in required_projection_names
                    if name not in completed_projection_names
                ]
                if missing_projection_names:
                    raise RuntimeError(
                        "rollback projections remain incomplete: "
                        + ", ".join(missing_projection_names)
                    )
                intent = transaction_store.save_rollback_intent(
                    state.process_id,
                    {
                        **intent,
                        "phase": "projections_committed",
                        "status": "in_progress",
                        "completed_projections": completed_projection_names,
                    },
                )
            response = {
                "rolled_back": True,
                "state": applied_state,
                "fencepost": target_fencepost,
                "restore_state": restore_state,
                "snapshot": restored_snapshot,
                "shared_state": restored_shared,
                "rollback_event": (rollback_event.model_dump() if hasattr(rollback_event, "model_dump") else rollback_event.dict()) if rollback_event is not None else None,
                "rollback_transaction": intent,
                "rollback_projections": projection_result,
                "applied": True,
                "production_image_ref": target_fencepost.get("image_ref"),
                "production_image_digest": target_fencepost.get("image_digest"),
                "operator_rollback_command": (applied_state.metadata or {}).get(
                    "operator_rollback_command"
                ),
                "operator_summary": (
                    f"release rollback applied for {state.process_id}: {state.current_stage} -> {applied_state.current_stage} "
                    f"via {target_fencepost_id or 'unknown_fencepost'}"
                ),
            }
            committed_response = _committed_rollback_descriptor(response)
            intent = transaction_store.save_rollback_intent(
                state.process_id,
                {
                    **intent,
                    "phase": "committed",
                    "status": "committed",
                    "committed_response": committed_response,
                    "committed_response_digest": (
                        "sha256:"
                        + hashlib.sha256(
                            json.dumps(
                                committed_response,
                                sort_keys=True,
                                separators=(",", ":"),
                            ).encode("utf-8")
                        ).hexdigest()
                    ),
                },
            )
            response["rollback_transaction"] = intent
        except BaseException as exc:
            latest_intent = transaction_store.load_rollback_intent(state.process_id) or intent
            transaction_store.save_rollback_intent(
                state.process_id,
                {**latest_intent, "status": "recovery_required", "last_error": f"{type(exc).__name__}: {exc}"},
            )
            raise
        finally:
            recovery_admission.__exit__(None, None, None)

        return response


__all__ = [
    "RELEASE_STAGE_TOPOLOGY",
    "ReleaseCanaryPolicy",
    "ReleaseArtifactReceipt",
    "ReleaseArtifactStorageLimits",
    "ReleaseArtifactStore",
    "ReleaseRollbackFencepost",
    "ReleaseWorkflowHistoryRecord",
    "ReleaseWorkflowState",
    "ReleaseWorkflowStore",
    "advance_release_workflow",
    "apply_release_rollback_restore",
    "capture_release_rollback_fencepost",
    "compile_release_handoff",
    "compile_release_repair_plan",
    "canonical_release_artifact_bytes",
    "create_release_artifact_receipt",
    "evaluate_release_promotion_gate",
    "record_release_fencepost",
    "record_release_artifact_receipt",
    "record_release_handoff",
    "prepare_release_artifact",
    "normalize_production_image_binding",
    "operator_rollback_command",
    "production_image_binding_from_claims",
    "production_image_binding_from_state",
    "release_canary_policy",
    "release_artifact_attestation_signature",
    "release_artifact_storage_limits",
    "repair_release_workflow",
    "rollback_release_workflow",
    "verify_release_artifact_receipt",
    "verify_release_artifact_receipt_payload",
    "ValidationError",
]
