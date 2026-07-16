from __future__ import annotations

import fcntl
import hashlib
import hmac
import json
import math
import os
import threading
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Sequence
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from cortex_server.runtime.agent_mailbox import AgentMailbox, AgentMessage, release_ack_authentication_required
from cortex_server.runtime.agent_supervisor import AgentLease, AgentSupervisor
from cortex_server.runtime.handoff_contract import HandoffArtifactRef, HandoffContract, HandoffEvidenceRef
from cortex_server.runtime.process_event import ProcessEvent
from cortex_server.runtime.process_journal import ProcessJournal
from cortex_server.runtime.process_snapshot import ProcessSnapshot, ProcessSnapshotStore
from cortex_server.runtime.session_registry import SessionRecord
from cortex_server.runtime.shared_process_state import SharedProcessState, SharedProcessStateStore


JsonDict = Dict[str, Any]


RELEASE_STAGE_TOPOLOGY = ("draft", "build_verified", "canary_verified", "production")


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
    path.parent.mkdir(parents=True, exist_ok=True)
    encoded = (json.dumps(payload, sort_keys=True, indent=2) + "\n").encode("utf-8")
    temporary = path.with_name(f".{path.name}.{os.getpid()}.{uuid4().hex}.tmp")
    try:
        with temporary.open("xb") as handle:
            handle.write(encoded)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        directory_fd = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    finally:
        if temporary.exists():
            temporary.unlink()


def _append_fsynced_jsonl(path: Path, payload: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(payload, sort_keys=True) + "\n")
        handle.flush()
        os.fsync(handle.fileno())



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


class ReleaseArtifactStore:
    """Content-addressed immutable release outputs used by signed attestations."""

    def __init__(self, path: str | Path):
        self.path = Path(path)

    def _target(self, content_hash: str) -> Path:
        digest = str(content_hash or "").removeprefix("sha256:")
        if len(digest) != 64 or any(ch not in "0123456789abcdef" for ch in digest):
            raise ValueError("content_hash must be a lowercase SHA-256 digest")
        return self.path / digest[:2] / f"{digest}.artifact"

    def put(self, payload: Any) -> tuple[str, str]:
        encoded = _artifact_payload_bytes(payload)
        content_hash = f"sha256:{hashlib.sha256(encoded).hexdigest()}"
        target = self._target(content_hash)
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists():
            if target.read_bytes() != encoded:
                raise ValueError("immutable artifact digest collision")
        else:
            temporary = target.with_name(f".{target.name}.{os.getpid()}.{uuid4().hex}.tmp")
            try:
                with temporary.open("xb") as handle:
                    handle.write(encoded)
                    handle.flush()
                    os.fsync(handle.fileno())
                os.replace(temporary, target)
                directory_fd = os.open(target.parent, os.O_RDONLY)
                try:
                    os.fsync(directory_fd)
                finally:
                    os.close(directory_fd)
            finally:
                if temporary.exists():
                    temporary.unlink()
        return content_hash, content_hash

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
    verifier_credentials: Optional[Dict[str, str]] = None,
) -> None:
    if receipt.producer == receipt.verifier:
        raise PermissionError("release artifact producer cannot self-verify")
    credentials = dict(verifier_credentials) if verifier_credentials is not None else _release_verifier_credentials()
    secret = str(credentials.get(receipt.verifier) or "").strip()
    if not secret:
        raise PermissionError(f"release artifact verifier is not authorized: {receipt.verifier}")
    expected_signature = release_artifact_attestation_signature(receipt.model_dump(), secret=secret)
    if not hmac.compare_digest(receipt.attestation_signature, expected_signature):
        raise PermissionError("release artifact attestation signature is invalid")
    encoded = artifact_store.resolve(receipt.artifact_ref)
    actual_hash = f"sha256:{hashlib.sha256(encoded).hexdigest()}"
    if not hmac.compare_digest(receipt.content_hash, actual_hash):
        raise ValueError("release artifact receipt content hash does not match immutable artifact")
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
    return bool(
        deployment_id
        and cohort_id
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
    artifact_store: ReleaseArtifactStore,
    verifier_credentials: Optional[Dict[str, str]] = None,
) -> ReleaseWorkflowState:
    record = receipt if isinstance(receipt, ReleaseArtifactReceipt) else ReleaseArtifactReceipt.model_validate(receipt)
    if (
        record.candidate_ref != state.candidate_ref
        or record.release_id != state.release_id
        or record.revision_id != state.revision_id
    ):
        raise ValueError("artifact receipt is not bound to the active release candidate and revision")
    verify_release_artifact_receipt(
        record,
        artifact_store=artifact_store,
        verifier_credentials=verifier_credentials,
    )
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
    if existing is not None and existing != record.model_dump():
        raise ValueError(f"immutable release artifact receipt already exists: {record.artifact_id}")
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
    rows.append(record.model_dump())
    return _copy_state(
        state,
        metadata={**dict(state.metadata), "release_artifacts": rows},
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
        self.path = Path(path)
        self._transaction_local = threading.local()

    def _target(self, process_id: Optional[str] = None) -> Path:
        if self.path.suffix:
            return self.path
        if not process_id:
            raise ValueError("process_id required when release store path is a directory")
        return self.path / f"{process_id}.json"

    def _history_target(self, process_id: str) -> Path:
        process = str(process_id or "").strip()
        if not process:
            raise ValueError("process_id required for release history target")
        if self.path.suffix:
            return self.path.with_name(self.path.name + f".{process}.history.jsonl")
        return self.path / "history" / f"{process}.jsonl"

    def _append_history(self, record: ReleaseWorkflowHistoryRecord) -> None:
        target = self._history_target(record.process_id)
        _append_fsynced_jsonl(target, _history_dump_compat(record))

    def _rollback_intent_target(self, process_id: str) -> Path:
        target = self._target(process_id)
        return target.with_name(f".{target.name}.rollback-intent.json")

    def _rollback_lock_target(self, process_id: str) -> Path:
        target = self._target(process_id)
        return target.with_name(f".{target.name}.rollback.lock")

    def artifact_store(self) -> ReleaseArtifactStore:
        root = self.path.parent / f"{self.path.stem}_artifacts" if self.path.suffix else self.path / "artifacts"
        return ReleaseArtifactStore(root)

    @contextmanager
    def release_transaction(self, process_id: str):
        """Serialize every release mutation for one process across processes.

        The transaction is re-entrant for callers such as reconciliation and
        rollback that compose store operations under one larger transaction.
        """

        process = str(process_id or "").strip()
        if not process:
            raise ValueError("process_id required for release transaction")
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

        lock_target = self._rollback_lock_target(process_id)
        lock_target.parent.mkdir(parents=True, exist_ok=True)
        with lock_target.open("a+b") as handle:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
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
        _atomic_write_json(self._rollback_intent_target(process_id), payload)
        return payload

    def load(self, process_id: Optional[str] = None) -> Optional[ReleaseWorkflowState]:
        target = self._target(process_id)
        if not target.exists():
            return None
        return _workflow_validate_compat(json.loads(target.read_text(encoding="utf-8")))

    def history(self, process_id: str) -> List[ReleaseWorkflowHistoryRecord]:
        target = self._history_target(process_id)
        if not target.exists():
            return []
        rows: List[ReleaseWorkflowHistoryRecord] = []
        with target.open("r", encoding="utf-8") as handle:
            for line in handle:
                text = line.strip()
                if not text:
                    continue
                rows.append(_history_validate_compat(json.loads(text)))
        return rows

    def save(
        self,
        state: ReleaseWorkflowState | Dict[str, Any],
        *,
        actor: Optional[str] = None,
        provenance: Optional[Dict[str, Any]] = None,
    ) -> ReleaseWorkflowState:
        record = state if isinstance(state, ReleaseWorkflowState) else _workflow_validate_compat(dict(state))
        with self.release_transaction(record.process_id):
            current = self.load(record.process_id)
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
            target = self._target(record.process_id)
            _atomic_write_json(target, _workflow_dump_compat(persisted))
            # Most callers retain the model they supplied. Once the atomic
            # state replacement has committed, keep that model's fence in sync
            # even if a later history append reports an I/O error.
            if isinstance(state, ReleaseWorkflowState):
                state.persistence_revision = next_revision
            self._append_history(
                ReleaseWorkflowHistoryRecord(
                    process_id=persisted.process_id,
                    release_id=persisted.release_id,
                    revision_id=persisted.revision_id,
                    current_stage=persisted.current_stage,
                    status=persisted.status,
                    actor=str(actor or "").strip() or None,
                    provenance={
                        **dict(provenance or {}),
                        "persistence_revision": next_revision,
                    },
                    change_set=_state_change_set(current, persisted),
                    state=_workflow_dump_compat(persisted),
                )
            )
            return persisted



def capture_release_rollback_fencepost(
    *,
    snapshot: ProcessSnapshot,
    shared_state: SharedProcessState,
    stage: str,
    latest_event: Optional[ProcessEvent] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> ReleaseRollbackFencepost:
    if snapshot.process_id != shared_state.process_id:
        raise ValueError("snapshot and shared_state must refer to the same process_id")
    stage_name = str(stage or "").strip()
    if not stage_name:
        raise ValueError("stage must be non-empty")
    restore_state = {
        "process_id": snapshot.process_id,
        "snapshot_id": snapshot.snapshot_id,
        "shared_state_revision_id": shared_state.revision_id,
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
        last_event_id=(latest_event.event_id if latest_event else snapshot.last_event_id),
        lifecycle_state=snapshot.lifecycle_state,
        restore_state=restore_state,
        metadata={
            **dict(metadata or {}),
            "snapshot_event_count": int(snapshot.event_count or 0),
            "shared_state_id": shared_state.state_id,
        },
    )



def record_release_fencepost(state: ReleaseWorkflowState, fencepost: ReleaseRollbackFencepost) -> ReleaseWorkflowState:
    if fencepost.process_id != state.process_id:
        raise ValueError("fencepost process_id must match release workflow state")
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
    verifier_credentials: Optional[Dict[str, str]] = None,
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
    acked_messages = [
        row for row in relevant_messages
        if _is_bound_release_approval(
            row,
            state,
            target_stage=target,
            valid_receipts=valid_receipts_by_id,
            required_artifact_hashes=required_artifact_hashes,
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
        },
        updated_at=_now_iso(),
    )
    return {
        "rolled_back": True,
        "state": updated,
        "fencepost": target.model_dump() if hasattr(target, "model_dump") else target.dict(),
        "restore_state": dict(target.restore_state or {}),
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
    verifier_credentials: Optional[Dict[str, str]] = None,
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
        reclaim_now = _now() + timedelta(days=365)
        reclaimed = supervisor.reclaim_stale(now=reclaim_now)
        resolved_ids: List[str] = []
        for lease in supervisor.list(process_id=state.process_id, status="stale"):
            resolved = supervisor.resolve(lease.lease_id, status="released", metadata={"resolution": "release_gate_repair"})
            resolved_ids.append(resolved.lease_id)
        actions_taken.append(
            {
                "action": "resolve_stale_leases",
                "reclaimed_ids": [row.lease_id for row in reclaimed],
                "resolved_ids": resolved_ids,
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


def apply_release_rollback_restore(
    state: ReleaseWorkflowState,
    *,
    snapshot_store: ProcessSnapshotStore,
    shared_state_store: SharedProcessStateStore,
    release_store: Optional[ReleaseWorkflowStore] = None,
    journal: Optional[ProcessJournal] = None,
    session_registry: Any = None,
    stage: Optional[str] = None,
    fencepost_id: Optional[str] = None,
    actor: Optional[str] = None,
    reason: str = "rollback",
    new_revision_id: Optional[str] = None,
    required_projections: Optional[Sequence[str]] = None,
    projection_callback: Optional[Callable[..., Dict[str, Any]]] = None,
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
        resumable = bool(
            intent
            and intent.get("status") in {"in_progress", "recovery_required"}
            and intent.get("release_id") == state.release_id
        )
        if resumable:
            rolled_state = _workflow_validate_compat(dict(intent["rolled_state"]))
            target_fencepost = dict(intent["fencepost"])
            restore_state = dict(intent["restore_state"])
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
                    "release_id": state.release_id,
                    "source_stage": state.current_stage,
                    "source_revision_id": state.revision_id,
                    "target_revision_id": target_revision,
                    # Preserve the established rollback revision type suffix
                    # while retaining a server-assigned, transaction-unique
                    # identifier that callers cannot choose or collide with.
                    "rollback_revision_id": f"{transaction_id}_{uuid4().hex[:12]}.rollback",
                    "rollback_event_id": f"evt_{transaction_id}",
                    "rollback_snapshot_id": f"snap_{transaction_id}",
                    "reason": normalized_reason,
                    "actor": str(actor or "").strip() or None,
                    "rolled_state": _workflow_dump_compat(rolled_state),
                    "fencepost": target_fencepost,
                    "restore_state": restore_state,
                    "required_projections": _dedupe_rows(list(required_projections or [])),
                    "completed_projections": [],
                },
            )

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
            intent = transaction_store.save_rollback_intent(
                state.process_id,
                {**intent, "phase": "committed", "status": "committed"},
            )
        except BaseException as exc:
            latest_intent = transaction_store.load_rollback_intent(state.process_id) or intent
            transaction_store.save_rollback_intent(
                state.process_id,
                {**latest_intent, "status": "recovery_required", "last_error": f"{type(exc).__name__}: {exc}"},
            )
            raise

        return {
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
            "operator_summary": (
                f"release rollback applied for {state.process_id}: {state.current_stage} -> {applied_state.current_stage} "
                f"via {target_fencepost_id or 'unknown_fencepost'}"
            ),
        }


__all__ = [
    "RELEASE_STAGE_TOPOLOGY",
    "ReleaseCanaryPolicy",
    "ReleaseArtifactReceipt",
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
    "create_release_artifact_receipt",
    "evaluate_release_promotion_gate",
    "record_release_fencepost",
    "record_release_artifact_receipt",
    "record_release_handoff",
    "release_canary_policy",
    "release_artifact_attestation_signature",
    "repair_release_workflow",
    "rollback_release_workflow",
    "verify_release_artifact_receipt",
    "ValidationError",
]
