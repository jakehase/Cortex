from __future__ import annotations

import hashlib
import hmac
import json
import math
import os
import fcntl
import re
from contextlib import contextmanager
import sqlite3
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence
from urllib.error import HTTPError, URLError
from urllib.request import urlopen
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator

from cortex_server.runtime.agent_mailbox import AgentMailbox
from cortex_server.runtime.agent_supervisor import AgentLease, AgentSupervisor
from cortex_server.runtime.dependability import (
    DEPENDABILITY_CAMPAIGN_SCHEMA,
    build_unattended_profile,
    compile_dependability_repair_plan,
    load_dependability_report,
    unattended_profile_digest,
)
from cortex_server.runtime.durable_files import durable_mkdir, fsync_directory
from cortex_server.runtime.runtime_delivery_quota import (
    MAX_HISTORY_BYTES,
    MAX_HISTORY_RECORDS,
    MAX_REPORT_BYTES,
    MAX_REPORT_RECORDS,
    append_bounded_jsonl,
    assert_process_count,
    assert_runtime_delivery_capacity,
    bounded_jsonl_payload,
    encoded_json,
    read_recoverable_jsonl,
    runtime_delivery_capacity,
    runtime_delivery_quota_transaction,
)
from cortex_server.runtime.process_journal import ProcessJournal
from cortex_server.runtime.process_replay import replay_from_journal
from cortex_server.runtime.process_snapshot import ProcessSnapshot, ProcessSnapshotStore
from cortex_server.runtime.release_workflow import (
    RELEASE_STAGE_TOPOLOGY,
    ReleaseArtifactReceipt,
    ReleaseWorkflowState,
    ReleaseWorkflowStore,
    advance_release_workflow,
    capture_release_rollback_fencepost,
    compile_release_handoff,
    evaluate_release_promotion_gate,
    prepare_release_artifact,
    record_release_artifact_receipt,
    record_release_fencepost,
    record_release_handoff,
    repair_release_workflow,
    release_artifact_storage_limits,
    verify_release_artifact_receipt,
)
from cortex_server.runtime.shared_process_state import OpenDecision, SharedProcessState, SharedProcessStateStore


JsonDict = Dict[str, Any]


BUILTIN_BLOCKER_PREFIXES = ("BLOCKER:", "HUMAN:")
REQUIRED_RELEASE_HANDOFF_RECIPIENTS = ("release-verifier", "release-manager")
RUNTIME_DELIVERY_MOUNT_MARKER = ".cortex-durable-runtime-delivery"
REASONING_VOLUME_MOUNT_MARKER = ".cortex-durable-reasoning"
REASONING_AUTHORITY_SENTINEL = ".cortex-reasoning-authority"
REASONING_AUTHORITY_SCHEMA = "cortex.reasoning-authority.v1"
REASONING_DATABASE_NAME = "reasoning_runtime.db"
RUNTIME_DELIVERY_MANAGER_CAPABILITY_PROCESS_ID = "__cortex_manager_capability__"
RUNTIME_DELIVERY_MANAGER_CAPABILITY_REASON = "non_mutating_manager_capability_challenge"
MIN_PRODUCTION_SECRET_BYTES = 32
RELEASE_VERIFIER_TRUST_SCHEMA = "cortex.release-verifier-trust.v1"
RELEASE_VERIFIER_TRUST_FILE = ".release-verifier-trust.json"
RELEASE_VERIFIER_TRUST_LIMIT = 4096
_DEPENDABILITY_BOOT_ID_PATH = Path("/proc/sys/kernel/random/boot_id")
_DEPENDABILITY_BOOT_ID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
)


def _dependability_server_now() -> datetime:
    """Return the server clock used exclusively for production campaign evidence."""

    return datetime.now(timezone.utc)


def _dependability_server_monotonic() -> float:
    return time.monotonic()


def _dependability_server_boot_id() -> str:
    try:
        boot_id = _DEPENDABILITY_BOOT_ID_PATH.read_text(encoding="ascii").strip().lower()
    except OSError as exc:
        raise RuntimeError("dependability campaign boot identity is unavailable") from exc
    if not _DEPENDABILITY_BOOT_ID_RE.fullmatch(boot_id):
        raise RuntimeError("dependability campaign boot identity is invalid")
    return boot_id


def _dependability_clock_divergence_seconds() -> float:
    try:
        value = float(
            os.getenv("CORTEX_DEPENDABILITY_CLOCK_DIVERGENCE_SECONDS", "30")
        )
        if not math.isfinite(value) or value <= 0:
            raise ValueError
    except ValueError as exc:
        raise RuntimeError(
            "CORTEX_DEPENDABILITY_CLOCK_DIVERGENCE_SECONDS must be a positive finite number"
        ) from exc
    return min(value, 300.0)


def _production_environment() -> bool:
    return os.getenv("CORTEX_ENV", os.getenv("CORTEX_ENVIRONMENT", "development")).strip().lower() in {
        "production",
        "prod",
        "staging",
    }


def _reasoning_authority_binding(
    mount_id: str,
    database_name: str = REASONING_DATABASE_NAME,
) -> str:
    return f"{REASONING_AUTHORITY_SCHEMA}:{mount_id}:{database_name}"


def _production_request_credentials() -> Dict[str, str]:
    credentials = {
        name: os.getenv(name, "").strip()
        for name in (
            "CORTEX_WRITE_TOKEN",
            "CORTEX_ADMIN_TOKEN",
            "CORTEX_CODEC_ADMIN_TOKEN",
            "CORTEX_RELEASE_ARTIFACT_WRITE_TOKEN",
            "NEXUS_ASSURANCE_SIGNING_KEY",
            "NEXUS_OUTCOME_FEEDBACK_SIGNING_KEY",
            "NEXUS_OUTCOME_FEEDBACK_TOKEN",
        )
        if os.getenv(name, "").strip()
    }
    raw = os.getenv("CORTEX_MEMORY_SCOPE_CREDENTIALS", "").strip()
    if raw:
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise RuntimeError("CORTEX_MEMORY_SCOPE_CREDENTIALS must be valid JSON") from exc
        if not isinstance(parsed, dict):
            raise RuntimeError("CORTEX_MEMORY_SCOPE_CREDENTIALS must be a credential object")
        for credential_id, record in parsed.items():
            secret = str((record or {}).get("secret") or "").strip() if isinstance(record, dict) else ""
            if secret:
                credentials[f"CORTEX_MEMORY_SCOPE_CREDENTIALS:{credential_id}"] = secret
    return credentials


def _credential_separation_check(
    verifier_credentials: Dict[str, str],
    recipient_credentials: Dict[str, str],
) -> Dict[str, Any]:
    all_credentials = {
        **{f"release-verifier:{identity}": secret for identity, secret in verifier_credentials.items()},
        **{f"release-recipient:{identity}": secret for identity, secret in recipient_credentials.items()},
        **_production_request_credentials(),
    }
    weak = sorted(
        name for name, secret in all_credentials.items()
        if len(secret.encode("utf-8")) < MIN_PRODUCTION_SECRET_BYTES
    )
    by_secret: Dict[str, List[str]] = {}
    for name, secret in all_credentials.items():
        by_secret.setdefault(secret, []).append(name)
    reused = sorted(
        sorted(names)
        for names in by_secret.values()
        if len(names) > 1
    )
    return {
        "ok": not weak and not reused,
        "minimumSecretBytes": MIN_PRODUCTION_SECRET_BYTES,
        "weakCredentials": weak,
        "reusedCredentialGroups": reused,
        "error": None if not weak and not reused else "production credentials must be strong and pairwise distinct",
    }


def _runtime_delivery_credential_map(environment_name: str) -> Dict[str, str]:
    raw = os.getenv(environment_name, "").strip()
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"{environment_name} must be valid JSON") from exc
    if not isinstance(parsed, dict):
        raise RuntimeError(f"{environment_name} must map identities to secrets")
    credentials = {
        str(identity or "").strip(): str(secret or "").strip()
        for identity, secret in parsed.items()
    }
    if any(not identity or not secret for identity, secret in credentials.items()):
        raise RuntimeError(f"{environment_name} contains an empty identity or secret")
    if _production_environment():
        weak = [
            identity for identity, secret in credentials.items()
            if len(secret.encode("utf-8")) < MIN_PRODUCTION_SECRET_BYTES
        ]
        if weak:
            raise RuntimeError(
                f"{environment_name} secrets must contain at least {MIN_PRODUCTION_SECRET_BYTES} bytes: "
                + ", ".join(sorted(weak))
            )
        if len(set(credentials.values())) != len(credentials):
            raise RuntimeError(f"{environment_name} identities must use distinct secrets")
    return credentials


def _durable_release_verifier_credentials(
    delivery_root: Path,
    active_credentials: Dict[str, str],
    *,
    now: Optional[datetime] = None,
) -> tuple[Dict[str, str], JsonDict]:
    """Merge active verifier keys into append-only durable historical trust."""

    target = delivery_root / RELEASE_VERIFIER_TRUST_FILE
    lock_target = delivery_root / f"{RELEASE_VERIFIER_TRUST_FILE}.lock"
    current_iso = _now_iso(now)
    durable_mkdir(delivery_root)
    with lock_target.open("a+b") as lock_handle:
        os.chmod(lock_target, 0o600)
        fcntl.flock(lock_handle.fileno(), fcntl.LOCK_EX)
        try:
            payload: JsonDict = {
                "schema_version": RELEASE_VERIFIER_TRUST_SCHEMA,
                "credentials": {},
                "updated_at": current_iso,
            }
            if target.exists():
                loaded = json.loads(target.read_text(encoding="utf-8"))
                if not isinstance(loaded, dict) or loaded.get("schema_version") != RELEASE_VERIFIER_TRUST_SCHEMA:
                    raise RuntimeError("durable release verifier trust has an invalid schema")
                payload = dict(loaded)
            raw_records = payload.get("credentials")
            if not isinstance(raw_records, dict):
                raise RuntimeError("durable release verifier trust credentials are invalid")
            records: Dict[str, JsonDict] = {}
            for identity, raw_record in raw_records.items():
                verifier_id = str(identity or "").strip()
                if not verifier_id or not isinstance(raw_record, dict):
                    raise RuntimeError("durable release verifier trust contains an invalid identity")
                secret = str(raw_record.get("secret") or "").strip()
                digest = str(raw_record.get("secret_sha256") or "").strip()
                expected_digest = hashlib.sha256(secret.encode("utf-8")).hexdigest() if secret else ""
                if not secret or not hmac.compare_digest(digest, expected_digest):
                    raise RuntimeError(f"durable release verifier trust is corrupt for {verifier_id}")
                records[verifier_id] = dict(raw_record)

            added: List[str] = []
            for verifier_id, secret in active_credentials.items():
                existing = records.get(verifier_id)
                if existing is not None and not hmac.compare_digest(str(existing.get("secret") or ""), secret):
                    raise RuntimeError(
                        f"release verifier identity {verifier_id} cannot be reused with different key material"
                    )
                if existing is None:
                    records[verifier_id] = {
                        "secret": secret,
                        "secret_sha256": hashlib.sha256(secret.encode("utf-8")).hexdigest(),
                        "first_trusted_at": current_iso,
                    }
                    added.append(verifier_id)
            if len(records) > RELEASE_VERIFIER_TRUST_LIMIT:
                raise RuntimeError("durable release verifier trust capacity exceeded")

            trust_changed = not target.exists() or bool(added)
            updated_payload = {
                "schema_version": RELEASE_VERIFIER_TRUST_SCHEMA,
                "credentials": records,
                "updated_at": current_iso if trust_changed else str(payload.get("updated_at") or current_iso),
            }
            if trust_changed:
                _atomic_write_json(target, updated_payload)
                _fsync_directory(delivery_root)
            os.chmod(target, 0o600)
            trusted = {
                verifier_id: str(record["secret"])
                for verifier_id, record in records.items()
            }
            return trusted, {
                "ok": True,
                "path": str(target),
                "activeVerifierIds": sorted(active_credentials),
                "historicalVerifierIds": sorted(set(trusted) - set(active_credentials)),
                "trustedVerifierCount": len(trusted),
                "addedVerifierIds": sorted(added),
                "error": None,
            }
        finally:
            fcntl.flock(lock_handle.fileno(), fcntl.LOCK_UN)


def runtime_delivery_recipient_credentials() -> Dict[str, str]:
    """Return recipient-only credentials used by the public handoff consumer API."""

    return _runtime_delivery_credential_map("CORTEX_AGENT_ACK_CREDENTIALS")


def runtime_delivery_verifier_credentials() -> Dict[str, str]:
    """Return active attestation-only credentials for verifier challenges."""

    return _runtime_delivery_credential_map("CORTEX_RELEASE_VERIFIER_CREDENTIALS")


def runtime_delivery_verifier_capability_signature(
    *,
    verifier: str,
    request_id: str,
    requested_at: str,
    secret: str,
) -> str:
    signing_secret = str(secret or "").strip()
    if not signing_secret:
        return ""
    payload = {
        "version": "cortex.runtime_delivery.verifier_capability.v1",
        "verifier": str(verifier or "").strip(),
        "request_id": str(request_id or "").strip(),
        "requested_at": str(requested_at or "").strip(),
    }
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hmac.new(signing_secret.encode("utf-8"), canonical, hashlib.sha256).hexdigest()


def runtime_delivery_release_observation_signature(
    *,
    controller: str,
    nonce: str,
    requested_at: str,
    process_id: str,
    release_id: str,
    revision_id: str,
    target_stage: str,
    secret: str,
) -> str:
    """Authenticate one fresh, completely bound release health observation."""

    signing_secret = str(secret or "").strip()
    if not signing_secret:
        return ""
    payload = {
        "version": "cortex.runtime_delivery.release_observation.v1",
        "controller": str(controller or "").strip(),
        "nonce": str(nonce or "").strip(),
        "requested_at": str(requested_at or "").strip(),
        "process_id": str(process_id or "").strip(),
        "release_id": str(release_id or "").strip(),
        "revision_id": str(revision_id or "").strip(),
        "target_stage": str(target_stage or "").strip(),
    }
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode(
        "utf-8"
    )
    return hmac.new(
        signing_secret.encode("utf-8"), canonical, hashlib.sha256
    ).hexdigest()


def validate_production_delivery_credentials() -> Dict[str, Any]:
    """Validate all independent production signing authorities before serving."""

    release_artifact_storage_limits()
    verifier_credentials = _runtime_delivery_credential_map("CORTEX_RELEASE_VERIFIER_CREDENTIALS")
    recipient_credentials = runtime_delivery_recipient_credentials()
    if not verifier_credentials:
        raise RuntimeError("production requires release verifier credentials")
    required_server_credentials = (
        "CORTEX_WRITE_TOKEN",
        "CORTEX_ADMIN_TOKEN",
        "CORTEX_CODEC_ADMIN_TOKEN",
        "CORTEX_RELEASE_ARTIFACT_WRITE_TOKEN",
        "NEXUS_ASSURANCE_SIGNING_KEY",
        "NEXUS_OUTCOME_FEEDBACK_SIGNING_KEY",
        "NEXUS_OUTCOME_FEEDBACK_TOKEN",
    )
    missing_server = [name for name in required_server_credentials if not os.getenv(name, "").strip()]
    if missing_server:
        raise RuntimeError("production requires independent server credentials: " + ", ".join(missing_server))
    missing = [name for name in REQUIRED_RELEASE_HANDOFF_RECIPIENTS if not recipient_credentials.get(name)]
    if missing:
        raise RuntimeError("production requires release recipient credentials: " + ", ".join(missing))
    separation = _credential_separation_check(verifier_credentials, recipient_credentials)
    if not separation["ok"]:
        raise RuntimeError(str(separation["error"]))
    return separation


def runtime_delivery_handoff_claim_signature(
    *,
    recipient: str,
    process_id: str,
    expected_revision_id: str,
    request_id: str,
    requested_at: str,
    secret: str,
) -> str:
    """Sign one revision-bound handoff claim without transmitting its secret."""

    signing_secret = str(secret or "").strip()
    if not signing_secret:
        return ""
    payload = {
        "version": "cortex.runtime_delivery.handoff_claim.v1",
        "recipient": str(recipient or "").strip(),
        "process_id": str(process_id or "").strip(),
        "expected_revision_id": str(expected_revision_id or "").strip(),
        "request_id": str(request_id or "").strip(),
        "requested_at": str(requested_at or "").strip(),
    }
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hmac.new(signing_secret.encode("utf-8"), canonical, hashlib.sha256).hexdigest()


def runtime_delivery_handoff_discovery_signature(
    *,
    recipient: str,
    request_id: str,
    requested_at: str,
    secret: str,
) -> str:
    """Sign a recipient-scoped claim-next request without controller state."""

    signing_secret = str(secret or "").strip()
    if not signing_secret:
        return ""
    payload = {
        "version": "cortex.runtime_delivery.handoff_discovery.v1",
        "recipient": str(recipient or "").strip(),
        "request_id": str(request_id or "").strip(),
        "requested_at": str(requested_at or "").strip(),
    }
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hmac.new(signing_secret.encode("utf-8"), canonical, hashlib.sha256).hexdigest()


def runtime_delivery_artifact_fetch_signature(
    *,
    recipient: str,
    process_id: str,
    release_id: str,
    revision_id: str,
    artifact_ref: str,
    request_id: str,
    requested_at: str,
    secret: str,
) -> str:
    """Bind an artifact read to one authenticated release consumer and revision."""

    signing_secret = str(secret or "").strip()
    if not signing_secret:
        return ""
    payload = {
        "version": "cortex.runtime_delivery.artifact_fetch.v1",
        "recipient": str(recipient or "").strip(),
        "process_id": str(process_id or "").strip(),
        "release_id": str(release_id or "").strip(),
        "revision_id": str(revision_id or "").strip(),
        "artifact_ref": str(artifact_ref or "").strip(),
        "request_id": str(request_id or "").strip(),
        "requested_at": str(requested_at or "").strip(),
    }
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hmac.new(signing_secret.encode("utf-8"), canonical, hashlib.sha256).hexdigest()


def runtime_delivery_manager_rollback_signature(
    *,
    process_id: str,
    release_id: str,
    revision_id: str,
    idempotency_key: str,
    reason: str,
    request_id: str,
    requested_at: str,
    secret: str,
) -> str:
    signing_secret = str(secret or "").strip()
    if not signing_secret:
        return ""
    payload = {
        "version": "cortex.runtime_delivery.manager_rollback.v1",
        "process_id": str(process_id or "").strip(),
        "release_id": str(release_id or "").strip(),
        "revision_id": str(revision_id or "").strip(),
        "idempotency_key": str(idempotency_key or "").strip(),
        "reason": str(reason or "").strip(),
        "request_id": str(request_id or "").strip(),
        "requested_at": str(requested_at or "").strip(),
    }
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hmac.new(signing_secret.encode("utf-8"), canonical, hashlib.sha256).hexdigest()


def _probe_runtime_delivery_state_consistency(
    *,
    delivery_root: Path,
    reasoning_processes: Dict[str, Dict[str, Any]],
    verifier_credentials: Dict[str, str],
) -> JsonDict:
    """Validate every release-owned projection from one fail-closed view."""

    release_root = delivery_root / "release_workflow"
    release_store = ReleaseWorkflowStore(release_root)
    snapshot_store = ProcessSnapshotStore(delivery_root / "snapshots")
    shared_state_store = SharedProcessStateStore(delivery_root / "shared_state")
    loop_store = ProductionBuildLoopStore(delivery_root / "production_build_loop")
    pending: List[str] = []
    pending_bootstraps: List[str] = []
    errors: List[JsonDict] = []

    from cortex_server.runtime.watchers import WatcherRuntimeStore

    invalid_watcher_ids = WatcherRuntimeStore(delivery_root / "watchers.json").invalid_file_watcher_ids()
    if invalid_watcher_ids:
        errors.append(
            {
                "process_id": None,
                "check": "watcher_workspace_attestation",
                "error": "unattested file watchers require safe migration: " + ", ".join(sorted(invalid_watcher_ids)),
            }
        )

    # Roadmap execution is an acknowledged production projection too. Validate
    # every surviving authority, including framed histories and reports, even
    # when no release workflow has been initialized for that roadmap.
    from cortex_server.runtime.roadmap_executor import RoadmapExecutionStore

    roadmap_root = delivery_root / "roadmap_executor"
    roadmap_store = RoadmapExecutionStore(roadmap_root)
    roadmap_sources: Dict[str, set[str]] = {}
    for directory, suffix, source in (
        ("contracts", ".json", "contract"),
        ("state", ".json", "state"),
        ("history", ".jsonl", "history"),
        ("reports", ".jsonl", "reports"),
    ):
        for target in (roadmap_root / directory).glob(f"*{suffix}"):
            roadmap_sources.setdefault(target.name.removesuffix(suffix), set()).add(source)
    for process_id, sources in sorted(roadmap_sources.items()):
        try:
            contract = roadmap_store.load_contract(process_id)
            state = roadmap_store.load_state(process_id)
            if contract is None or state is None:
                raise ValueError(
                    "roadmap authoritative projection is incomplete: " + ", ".join(sorted(sources))
                )
            if contract.process_id != process_id or state.process_id != process_id:
                raise ValueError("roadmap process identity mismatch")
            if state.objective_id != contract.objective_id:
                raise ValueError("roadmap state objective does not match its contract")
            if state.persistence_revision < 1:
                raise ValueError("roadmap state lacks a committed persistence revision")
            read_recoverable_jsonl(roadmap_store._history_target(process_id))
            roadmap_store.reports(process_id)
        except (OSError, RuntimeError, ValueError, ValidationError, json.JSONDecodeError) as exc:
            errors.append(
                {
                    "process_id": process_id,
                    "check": "roadmap_projection_integrity",
                    "error": f"{type(exc).__name__}: {exc}",
                }
            )

    for intent_path in sorted(release_root.glob(".*.json.rollback-intent.json")):
        try:
            intent = json.loads(intent_path.read_text(encoding="utf-8"))
            if not isinstance(intent, dict):
                raise ValueError("rollback intent must be an object")
            process_id = str(intent.get("process_id") or "").strip()
            if not process_id:
                raise ValueError("rollback intent process_id is missing")
            if intent.get("status") in {"in_progress", "recovery_required"}:
                pending.append(process_id)
        except (OSError, json.JSONDecodeError, ValueError) as exc:
            errors.append(
                {
                    "process_id": None,
                    "check": "rollback_intent_integrity",
                    "error": f"{intent_path.name}: {type(exc).__name__}: {exc}",
                }
            )

    state_paths = [
        path
        for path in sorted(release_root.glob("*.json"))
        if not path.name.startswith(".")
    ]
    release_state_ids = {path.stem for path in state_paths}
    bootstrap_root = delivery_root / "release_bootstrap_intents"
    for intent_path in sorted(bootstrap_root.glob("*.json")):
        try:
            payload = json.loads(intent_path.read_text(encoding="utf-8"))
            if not isinstance(payload, dict) or payload.get("version") != "cortex.runtime-delivery.release-bootstrap.v1":
                raise ValueError("bootstrap intent has an invalid schema")
            process_id = str(payload.get("process_id") or "").strip()
            if not process_id or not isinstance(payload.get("request"), dict) or not isinstance(payload.get("contract"), dict):
                raise ValueError("bootstrap intent is incomplete")
            if str((payload.get("contract") or {}).get("process_id") or "") != process_id:
                raise ValueError("bootstrap intent contract identity mismatch")
            pending_bootstraps.append(process_id)
        except (OSError, ValueError, json.JSONDecodeError) as exc:
            errors.append(
                {
                    "process_id": None,
                    "check": "release_bootstrap_intent_integrity",
                    "error": f"{intent_path.name}: {type(exc).__name__}: {exc}",
                }
            )
    projection_sources = _runtime_delivery_projection_sources(
        delivery_root,
        reasoning_processes=reasoning_processes,
    )
    release_owned_sources = {
        "release_history",
        "rollback_intent",
        "production_contract",
        "production_state",
        "production_history",
        "production_report",
        "release_mailbox",
        "reasoning_runtime_delivery",
    }
    for orphan_process_id, sources in sorted(projection_sources.items()):
        if (
            orphan_process_id in release_state_ids
            or orphan_process_id in pending_bootstraps
            or not (sources & release_owned_sources)
        ):
            continue
        errors.append(
            {
                "process_id": orphan_process_id,
                "check": "release_projection_consistency",
                "error": (
                    "release workflow is missing while authoritative projections survive: "
                    + ", ".join(sorted(sources))
                ),
            }
        )
    for state_path in state_paths:
        process_id = state_path.stem
        try:
            with release_store.release_transaction(process_id):
                intent = release_store.load_rollback_intent(process_id)
                if intent and intent.get("status") in {"in_progress", "recovery_required"}:
                    raise RuntimeError("rollback intent requires recovery")
                state = release_store.load(process_id)
                if state is None:
                    raise ValueError("release workflow is missing")
                process_id = state.process_id
                snapshot = snapshot_store.load(process_id)
                shared_state = shared_state_store.load(process_id)
                loop_state = loop_store.load_state(process_id)
                process = reasoning_processes.get(process_id)
                missing = [
                    name
                    for name, value in (
                        ("snapshot", snapshot),
                        ("shared_state", shared_state),
                        ("production_loop", loop_state),
                        ("reasoning_process", process),
                    )
                    if value is None
                ]
                if missing:
                    raise ValueError("missing authoritative projections: " + ", ".join(missing))
                assert snapshot is not None and shared_state is not None and loop_state is not None and process is not None

                mismatches: List[str] = []
                if state.revision_id != shared_state.revision_id:
                    mismatches.append("release.revision_id != shared_state.revision_id")
                if loop_state.current_revision_id != shared_state.revision_id:
                    mismatches.append("loop.current_revision_id != shared_state.revision_id")
                if loop_state.current_snapshot_id != snapshot.snapshot_id:
                    mismatches.append("loop.current_snapshot_id != snapshot.snapshot_id")
                if loop_state.current_stage != state.current_stage:
                    mismatches.append("loop.current_stage != release.current_stage")

                workflow = process.get("workflow") if isinstance(process.get("workflow"), dict) else {}
                metadata = workflow.get("metadata") if isinstance(workflow.get("metadata"), dict) else {}
                projection = metadata.get("runtime_delivery") if isinstance(metadata.get("runtime_delivery"), dict) else {}
                expected_projection = {
                    "release_id": state.release_id,
                    "release_stage": state.current_stage,
                    "release_status": state.status,
                    "shared_state_revision_id": shared_state.revision_id,
                    "snapshot_id": snapshot.snapshot_id,
                    "loop_id": loop_state.loop_id,
                    "loop_status": loop_state.status,
                    "loop_iteration": loop_state.iteration_count,
                    "loop_persistence_revision": loop_state.persistence_revision,
                    "release_persistence_revision": state.persistence_revision,
                    "snapshot_persistence_revision": snapshot.persistence_revision,
                }
                for field, expected in expected_projection.items():
                    if projection.get(field) != expected:
                        mismatches.append(f"runtime_delivery.{field} is stale")
                if metadata.get("release_stage") != state.current_stage:
                    mismatches.append("workflow.release_stage is stale")
                if metadata.get("release_status") != state.status:
                    mismatches.append("workflow.release_status is stale")
                if metadata.get("delivery_revision_id") != shared_state.revision_id:
                    mismatches.append("workflow.delivery_revision_id is stale")
                workflow_policy = dict(((metadata.get("policy") or {}).get("settings") or {}))
                if workflow_policy != dict(snapshot.runtime_policy or {}):
                    mismatches.append("workflow policy differs from snapshot.runtime_policy")

                nodes = process.get("nodes") if isinstance(process.get("nodes"), dict) else {}
                expected_node_statuses = {
                    **{node_id: "running" for node_id in snapshot.active_steps},
                    **{node_id: "waiting" for node_id in snapshot.waiting_steps},
                    **{node_id: "completed" for node_id in snapshot.completed_steps},
                    **{node_id: "failed" for node_id in snapshot.failed_steps},
                }
                for node_id, expected_status in expected_node_statuses.items():
                    observed_status = str((nodes.get(node_id) or {}).get("status") or "")
                    if observed_status != expected_status:
                        mismatches.append(f"reasoning node {node_id} is {observed_status or 'missing'}, expected {expected_status}")

                rollback_transaction_id = str((state.metadata or {}).get("rollback_transaction_id") or "").strip()
                if rollback_transaction_id:
                    if str((loop_state.metadata or {}).get("last_rollback_transaction_id") or "") != rollback_transaction_id:
                        mismatches.append("loop rollback transaction marker is stale")
                    if str(metadata.get("last_runtime_delivery_rollback_transaction_id") or "") != rollback_transaction_id:
                        mismatches.append("reasoning rollback transaction marker is stale")

                artifact_store = release_store.artifact_store()
                active_receipts: Dict[str, ReleaseArtifactReceipt] = {}
                evidence_revision_id, activation_error = _active_release_evidence_revision(
                    state,
                    rollback_transaction_id=rollback_transaction_id,
                )
                if activation_error:
                    mismatches.append(activation_error)
                for raw_receipt in state.metadata.get("release_artifacts") or []:
                    receipt = ReleaseArtifactReceipt.model_validate(raw_receipt)
                    verify_release_artifact_receipt(
                        receipt,
                        artifact_store=artifact_store,
                        verifier_credentials=verifier_credentials,
                    )
                    if receipt.release_id == state.release_id and receipt.revision_id == evidence_revision_id:
                        if receipt.candidate_ref != state.candidate_ref or receipt.validation_outcome != "passed":
                            mismatches.append(f"active artifact {receipt.artifact_id} has invalid release binding")
                        else:
                            active_receipts[receipt.artifact_id] = receipt

                # Draft releases have not crossed an evidence gate yet. Every
                # promoted stage must retain the immutable, revision-bound
                # evidence that made that stage admissible. Older valid
                # receipts remain audit history and are integrity-checked
                # above, but do not satisfy the active revision's gate.
                contract = loop_store.load_contract(process_id)
                if state.current_stage != "draft":
                    if contract is None:
                        mismatches.append("production contract is missing")
                    else:
                        required_artifacts = _stage_gate_for(contract, state.current_stage).required_artifacts
                        for artifact_id in required_artifacts:
                            receipt = active_receipts.get(artifact_id)
                            if receipt is None:
                                mismatches.append(f"required active artifact {artifact_id} is missing")
                            elif (
                                artifact_id.startswith("artifact_release_bundle:")
                                and receipt.artifact_kind != "release_bundle"
                            ) or (
                                artifact_id.startswith("artifact_smoke_report:")
                                and receipt.artifact_kind != "smoke_report"
                            ):
                                mismatches.append(f"required active artifact {artifact_id} has the wrong kind")

                if mismatches:
                    raise ValueError("; ".join(mismatches))
        except (OSError, RuntimeError, ValueError, ValidationError, json.JSONDecodeError) as exc:
            errors.append(
                {
                    "process_id": process_id,
                    "check": "release_projection_consistency",
                    "error": f"{type(exc).__name__}: {exc}",
                }
            )

    pending = sorted(set(pending))
    pending_bootstraps = sorted(set(pending_bootstraps))
    for process_id in pending_bootstraps:
        errors.append(
            {
                "process_id": process_id,
                "check": "release_bootstrap_recovery_pending",
                "error": "durable release bootstrap intent requires startup recovery",
            }
        )
    for process_id in pending:
        errors.append(
            {
                "process_id": process_id,
                "check": "rollback_recovery_pending",
                "error": "rollback intent is in_progress or recovery_required",
            }
        )
    return {
        "ok": not errors,
        "releaseCount": len(release_state_ids),
        "pendingRollbackProcessIds": pending,
        "pendingBootstrapProcessIds": pending_bootstraps,
        "inconsistencies": errors,
        "error": None if not errors else "runtime delivery projections require recovery",
    }


def _active_release_evidence_revision(
    state: ReleaseWorkflowState,
    *,
    rollback_transaction_id: str,
) -> tuple[str, Optional[str]]:
    """Resolve a server-sealed rollback's restored artifact revision."""

    if state.status != "rolled_back":
        return state.revision_id, None
    activation = (state.metadata or {}).get("rollback_activation")
    if not isinstance(activation, dict):
        return state.revision_id, "rollback activation record is missing"
    fencepost_id = str(activation.get("fencepost_id") or "")
    activation_fencepost = next(
        (row for row in state.rollback_fenceposts if row.fencepost_id == fencepost_id),
        None,
    )
    artifact_revision_id = str(activation.get("artifact_revision_id") or "")
    valid_activation = bool(
        activation.get("version") == "cortex.release.rollback-activation.v1"
        and str(activation.get("transaction_id") or "") == rollback_transaction_id
        and str(activation.get("control_revision_id") or "") == state.revision_id
        and str(activation.get("stage") or "") == state.current_stage
        and activation_fencepost is not None
        and activation_fencepost.stage == state.current_stage
        and activation_fencepost.shared_state_revision_id == artifact_revision_id
    )
    if not valid_activation:
        return state.revision_id, "rollback activation record does not match its fencepost"
    return artifact_revision_id, None


def _runtime_delivery_projection_sources(
    delivery_root: Path,
    *,
    reasoning_processes: Optional[Dict[str, Dict[str, Any]]] = None,
) -> Dict[str, set[str]]:
    """Index the union of durable runtime-delivery authorities by process."""

    sources: Dict[str, set[str]] = {}

    def add(process_id: str, source: str) -> None:
        normalized = str(process_id or "").strip()
        if normalized:
            sources.setdefault(normalized, set()).add(source)

    release_root = delivery_root / "release_workflow"
    for target in release_root.glob("*.json"):
        if not target.name.startswith("."):
            add(target.stem, "release_state")
    for target in (release_root / "history").glob("*.jsonl"):
        add(target.stem, "release_history")
    for target in release_root.glob(".*.json.rollback-intent.json"):
        name = target.name.removeprefix(".").removesuffix(".json.rollback-intent.json")
        add(name, "rollback_intent")

    loop_root = delivery_root / "production_build_loop"
    for directory, suffix, source in (
        ("contracts", ".json", "production_contract"),
        ("state", ".json", "production_state"),
        ("history", ".jsonl", "production_history"),
        ("reports", ".jsonl", "production_report"),
    ):
        for target in (loop_root / directory).glob(f"*{suffix}"):
            add(target.name.removesuffix(suffix), source)

    for directory, source in (("snapshots", "snapshot"), ("shared_state", "shared_state")):
        for target in (delivery_root / directory).glob("*.json"):
            add(target.stem, source)

    mailbox_path = delivery_root / "mailbox.json"
    if mailbox_path.exists():
        payload = json.loads(mailbox_path.read_text(encoding="utf-8"))
        rows = payload if isinstance(payload, list) else payload.get("messages", []) if isinstance(payload, dict) else []
        for row in rows:
            if not isinstance(row, dict):
                continue
            metadata = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
            if (
                "release" in str(row.get("kind") or "").lower()
                or any(key in metadata for key in ("release_id", "target_stage", "release_stage"))
            ):
                add(str(row.get("process_id") or ""), "release_mailbox")

    for process_id, process in (reasoning_processes or {}).items():
        workflow = process.get("workflow") if isinstance(process.get("workflow"), dict) else {}
        metadata = workflow.get("metadata") if isinstance(workflow.get("metadata"), dict) else {}
        projection = metadata.get("runtime_delivery") if isinstance(metadata.get("runtime_delivery"), dict) else {}
        if projection.get("release_id") or isinstance(metadata.get("production_build_loop"), dict):
            add(process_id, "reasoning_runtime_delivery")
    return sources


def probe_runtime_delivery_readiness(root: str | Path) -> JsonDict:
    """Fail closed unless release credentials and the durable delivery mount are usable."""

    checks: Dict[str, Dict[str, Any]] = {}
    verifier_credentials: Dict[str, str] = {}
    recipient_credentials: Dict[str, str] = {}
    try:
        verifier_credentials = _runtime_delivery_credential_map("CORTEX_RELEASE_VERIFIER_CREDENTIALS")
        checks["releaseVerifierCredentials"] = {
            "ok": bool(verifier_credentials),
            "configuredVerifierCount": len(verifier_credentials),
            "error": None if verifier_credentials else "no release verifier credentials configured",
        }
    except RuntimeError as exc:
        checks["releaseVerifierCredentials"] = {
            "ok": False,
            "configuredVerifierCount": 0,
            "error": str(exc),
        }

    try:
        recipient_credentials = runtime_delivery_recipient_credentials()
        missing_recipients = [
            recipient
            for recipient in REQUIRED_RELEASE_HANDOFF_RECIPIENTS
            if not recipient_credentials.get(recipient)
        ]
        checks["releaseRecipientCredentials"] = {
            "ok": not missing_recipients,
            "requiredRecipients": list(REQUIRED_RELEASE_HANDOFF_RECIPIENTS),
            "missingRecipients": missing_recipients,
            "error": None if not missing_recipients else "required release recipient credentials are missing",
        }

    except RuntimeError as exc:
        checks["releaseRecipientCredentials"] = {
            "ok": False,
            "requiredRecipients": list(REQUIRED_RELEASE_HANDOFF_RECIPIENTS),
            "missingRecipients": list(REQUIRED_RELEASE_HANDOFF_RECIPIENTS),
            "error": str(exc),
        }

    if _production_environment():
        try:
            checks["credentialSeparation"] = _credential_separation_check(
                verifier_credentials,
                recipient_credentials,
            )
        except RuntimeError as exc:
            checks["credentialSeparation"] = {
                "ok": False,
                "minimumSecretBytes": MIN_PRODUCTION_SECRET_BYTES,
                "weakCredentials": [],
                "reusedCredentialGroups": [],
                "error": str(exc),
            }

        consumer_health: Dict[str, Dict[str, Any]] = {}
        for recipient, variable in (
            ("release-verifier", "CORTEX_RELEASE_VERIFIER_HEALTH_URL"),
            ("release-manager", "CORTEX_RELEASE_MANAGER_HEALTH_URL"),
        ):
            url = os.getenv(variable, "").strip()
            error: Optional[str] = None
            if not url:
                error = f"{variable} is not configured"
            else:
                try:
                    with urlopen(url, timeout=2.0) as response:
                        if int(getattr(response, "status", 0) or 0) != 200:
                            raise RuntimeError(f"consumer health returned HTTP {getattr(response, 'status', 0)}")
                except (HTTPError, URLError, OSError, RuntimeError, TimeoutError) as exc:
                    error = f"{type(exc).__name__}: {exc}"
            consumer_health[recipient] = {"ok": error is None, "url": url or None, "error": error}
        checks["releaseConsumers"] = {
            "ok": all(row["ok"] for row in consumer_health.values()),
            "consumers": consumer_health,
        }

    delivery_root = Path(root)
    handoff_receipt_root = delivery_root / "handoff_claim_receipts"
    try:
        handoff_receipt_retention = min(
            max(int(os.getenv("CORTEX_HANDOFF_CLAIM_MAX_SKEW_SECONDS", "300")), 30),
            900,
        )
    except ValueError:
        handoff_receipt_retention = 300
    try:
        handoff_receipt_count = sum(1 for _ in handoff_receipt_root.glob("*.json")) if handoff_receipt_root.exists() else 0
        handoff_receipt_error = None if handoff_receipt_count <= 4096 else "handoff claim receipt capacity exceeded"
    except OSError as exc:
        handoff_receipt_count = -1
        handoff_receipt_error = f"{type(exc).__name__}: {exc}"
    checks["handoffClaimReceiptCapacity"] = {
        "ok": handoff_receipt_error is None,
        "path": str(handoff_receipt_root),
        "count": handoff_receipt_count,
        "maximum": 4096,
        "retentionSeconds": handoff_receipt_retention,
        "error": handoff_receipt_error,
    }
    mount_id = os.getenv("CORTEX_RUNTIME_DELIVERY_MOUNT_ID", "").strip()
    marker_path = delivery_root / RUNTIME_DELIVERY_MOUNT_MARKER
    durable_error: Optional[str] = None
    observed_mount_id: Optional[str] = None
    try:
        if not delivery_root.is_absolute():
            raise RuntimeError("runtime delivery root must be an absolute path")
        if not mount_id:
            raise RuntimeError("CORTEX_RUNTIME_DELIVERY_MOUNT_ID is not configured")
        observed_mount_id = marker_path.read_text(encoding="utf-8").strip()
        if not hmac.compare_digest(observed_mount_id, mount_id):
            raise RuntimeError("runtime delivery volume identity mismatch")
        probe_path = delivery_root / f".cortex-readiness-{os.getpid()}-{uuid4().hex}"
        try:
            with probe_path.open("xb") as handle:
                handle.write(b"runtime-delivery-ready\n")
                handle.flush()
                os.fsync(handle.fileno())
        finally:
            if probe_path.exists():
                probe_path.unlink()
        _fsync_directory(delivery_root)
    except (OSError, RuntimeError) as exc:
        durable_error = f"{type(exc).__name__}: {exc}"
    checks["durableRuntimeDeliveryRoot"] = {
        "ok": durable_error is None,
        "path": str(delivery_root),
        "markerPath": str(marker_path),
        "configuredMountId": mount_id or None,
        "observedMountId": observed_mount_id,
        "error": durable_error,
    }
    try:
        capacity = runtime_delivery_capacity(delivery_root)
        checks["runtimeDeliveryCapacity"] = {
            **capacity,
            "error": None if capacity["ok"] else "runtime delivery operational quota exhausted",
        }
    except OSError as exc:
        checks["runtimeDeliveryCapacity"] = {
            "ok": False,
            "error": f"{type(exc).__name__}: {exc}",
        }

    if _production_environment():
        try:
            if durable_error is not None:
                raise RuntimeError("durable runtime delivery root is unavailable")
            verifier_credentials, trust_check = _durable_release_verifier_credentials(
                delivery_root,
                verifier_credentials,
            )
            checks["releaseVerifierTrust"] = trust_check
            checks["historicalCredentialSeparation"] = _credential_separation_check(
                verifier_credentials,
                recipient_credentials,
            )
        except (OSError, RuntimeError, ValueError, json.JSONDecodeError) as exc:
            checks["releaseVerifierTrust"] = {
                "ok": False,
                "path": str(delivery_root / RELEASE_VERIFIER_TRUST_FILE),
                "activeVerifierIds": sorted(verifier_credentials),
                "historicalVerifierIds": [],
                "trustedVerifierCount": 0,
                "addedVerifierIds": [],
                "error": f"{type(exc).__name__}: {exc}",
            }
            checks["historicalCredentialSeparation"] = {
                "ok": False,
                "minimumSecretBytes": MIN_PRODUCTION_SECRET_BYTES,
                "weakCredentials": [],
                "reusedCredentialGroups": [],
                "error": "durable release verifier trust is unavailable",
            }

        reasoning_path = Path(
            os.getenv("REASONING_STORE_DB_PATH", "/opt/clawdbot/reasoning/reasoning_runtime.db")
        )
        reasoning_mount_id = os.getenv("CORTEX_REASONING_MOUNT_ID", "").strip()
        reasoning_marker_path = reasoning_path.parent / REASONING_VOLUME_MOUNT_MARKER
        reasoning_authority_path = reasoning_path.parent / REASONING_AUTHORITY_SENTINEL
        reasoning_error: Optional[str] = None
        quick_check: Optional[str] = None
        missing_process_ids: List[str] = []
        reasoning_processes: Dict[str, Dict[str, Any]] = {}
        try:
            if not reasoning_path.is_absolute():
                raise RuntimeError("reasoning store path must be absolute")
            if reasoning_path.parent.is_symlink() or not reasoning_path.parent.is_dir():
                raise RuntimeError("reasoning store volume is missing or invalid")
            if not reasoning_mount_id:
                raise RuntimeError("CORTEX_REASONING_MOUNT_ID is not configured")
            if reasoning_marker_path.is_symlink() or not reasoning_marker_path.is_file():
                raise RuntimeError("reasoning store volume marker is missing or invalid")
            observed_reasoning_mount_id = reasoning_marker_path.read_text(
                encoding="utf-8"
            ).strip()
            if not hmac.compare_digest(observed_reasoning_mount_id, reasoning_mount_id):
                raise RuntimeError("reasoning store volume identity mismatch")
            if reasoning_authority_path.is_symlink() or not reasoning_authority_path.is_file():
                raise RuntimeError("reasoning store authority sentinel is missing or invalid")
            observed_reasoning_authority = reasoning_authority_path.read_text(
                encoding="utf-8"
            ).strip()
            if not hmac.compare_digest(
                observed_reasoning_authority,
                _reasoning_authority_binding(reasoning_mount_id, reasoning_path.name),
            ):
                raise RuntimeError("reasoning store authority identity mismatch")
            if reasoning_path.is_symlink() or not reasoning_path.is_file():
                raise RuntimeError("reasoning store database is missing or invalid")
            persisted_release_ids = {
                process_id
                for process_id, sources in _runtime_delivery_projection_sources(delivery_root).items()
                if sources
                & {
                    "release_state",
                    "release_history",
                    "rollback_intent",
                    "production_contract",
                    "production_state",
                    "production_history",
                    "production_report",
                    "release_mailbox",
                }
            }
            release_root = delivery_root / "release_workflow"
            for state_path in [*release_root.glob("*.json"), *release_root.glob(".*.rollback-intent.json")]:
                payload = json.loads(state_path.read_text(encoding="utf-8"))
                process_id = str(payload.get("process_id") or "").strip() if isinstance(payload, dict) else ""
                if process_id:
                    persisted_release_ids.add(process_id)
            with sqlite3.connect(f"file:{reasoning_path}?mode=ro", uri=True, timeout=2.0) as connection:
                connection.execute("PRAGMA query_only = ON")
                row = connection.execute("PRAGMA quick_check").fetchone()
                schema_rows = connection.execute(
                    "SELECT type, name FROM sqlite_master "
                    "WHERE (type = 'table' OR type = 'index') AND name IN (?, ?, ?, ?)",
                    (
                        "reasoning_documents",
                        "reasoning_events",
                        "idx_reasoning_documents_ns_updated",
                        "idx_reasoning_events_ns_parent_created",
                    ),
                ).fetchall()
                document_columns = {
                    str(column[1])
                    for column in connection.execute(
                        "PRAGMA table_info(reasoning_documents)"
                    ).fetchall()
                }
                event_columns = {
                    str(column[1])
                    for column in connection.execute(
                        "PRAGMA table_info(reasoning_events)"
                    ).fetchall()
                }
                process_rows = connection.execute(
                    "SELECT doc_id, payload FROM reasoning_documents WHERE namespace = ?",
                    ("reasoning_processes",),
                ).fetchall()
            quick_check = str(row[0] if row else "")
            if quick_check != "ok":
                raise RuntimeError(f"reasoning store quick_check failed: {quick_check}")
            observed_schema = {(str(row[0]), str(row[1])) for row in schema_rows}
            required_schema = {
                ("table", "reasoning_documents"),
                ("table", "reasoning_events"),
                ("index", "idx_reasoning_documents_ns_updated"),
                ("index", "idx_reasoning_events_ns_parent_created"),
            }
            missing_schema = sorted(
                name for _item_type, name in required_schema - observed_schema
            )
            if missing_schema:
                raise RuntimeError(
                    "reasoning store schema is incomplete: " + ", ".join(missing_schema)
                )
            required_document_columns = {
                "namespace", "doc_id", "created_at", "updated_at", "payload"
            }
            required_event_columns = {
                "namespace",
                "parent_id",
                "event_id",
                "created_at",
                "updated_at",
                "payload",
            }
            if not required_document_columns.issubset(document_columns):
                raise RuntimeError("reasoning_documents schema is incomplete")
            if not required_event_columns.issubset(event_columns):
                raise RuntimeError("reasoning_events schema is incomplete")
            process_ids = {str(row[0]) for row in process_rows}
            for row in process_rows:
                payload = json.loads(str(row[1]))
                if not isinstance(payload, dict):
                    raise RuntimeError(f"reasoning process {row[0]} payload is invalid")
                reasoning_processes[str(row[0])] = payload
            missing_process_ids = sorted(persisted_release_ids - process_ids)
            if missing_process_ids:
                raise RuntimeError(
                    "persisted release state references missing runtime processes: "
                    + ", ".join(missing_process_ids)
                )
        except (OSError, RuntimeError, sqlite3.Error) as exc:
            reasoning_error = f"{type(exc).__name__}: {exc}"
        except (json.JSONDecodeError, ValueError) as exc:
            reasoning_error = f"{type(exc).__name__}: invalid persisted release state: {exc}"
        checks["durableReasoningStore"] = {
            "ok": reasoning_error is None,
            "path": str(reasoning_path),
            "markerPath": str(reasoning_marker_path),
            "authorityPath": str(reasoning_authority_path),
            "configuredMountId": reasoning_mount_id or None,
            "quickCheck": quick_check,
            "missingProcessIds": missing_process_ids,
            "error": reasoning_error,
        }
        try:
            checks["runtimeDeliveryConsistency"] = _probe_runtime_delivery_state_consistency(
                delivery_root=delivery_root,
                reasoning_processes=reasoning_processes,
                verifier_credentials=verifier_credentials,
            )
        except (OSError, RuntimeError, ValueError, ValidationError, json.JSONDecodeError) as exc:
            checks["runtimeDeliveryConsistency"] = {
                "ok": False,
                "releaseCount": 0,
                "pendingRollbackProcessIds": [],
                "inconsistencies": [],
                "error": f"{type(exc).__name__}: {exc}",
            }

    ready = all(check["ok"] for check in checks.values())
    return {
        "status": "ready" if ready else "not_ready",
        "ready": ready,
        "service": "cortex-runtime-delivery",
        "checks": checks,
    }


def _fsync_directory(path: Path) -> None:
    fsync_directory(path)


def _atomic_write_json(path: Path, payload: Dict[str, Any]) -> None:
    durable_mkdir(path.parent)
    encoded = (json.dumps(payload, sort_keys=True, indent=2) + "\n").encode("utf-8")
    temporary = path.with_name(f".{path.name}.{os.getpid()}.{uuid4().hex}.tmp")
    try:
        with temporary.open("xb") as handle:
            os.fchmod(handle.fileno(), 0o600)
            handle.write(encoded)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        _fsync_directory(path.parent)
    finally:
        if temporary.exists():
            temporary.unlink()


def _read_recoverable_jsonl(path: Path) -> List[Dict[str, Any]]:
    """Read committed JSONL records, ignoring only a torn final record."""

    if not path.exists():
        return []
    encoded = path.read_bytes()
    lines = encoded.splitlines(keepends=True)
    rows: List[Dict[str, Any]] = []
    for index, raw_line in enumerate(lines):
        complete = raw_line.endswith(b"\n")
        text = raw_line.strip()
        if not text:
            continue
        try:
            payload = json.loads(text.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            if index == len(lines) - 1 and not complete:
                break
            raise
        if not isinstance(payload, dict):
            raise ValueError(f"JSONL record in {path} must be an object")
        if index == len(lines) - 1 and not complete:
            # A complete-looking record without its frame delimiter may still
            # be the prefix of a larger write, so it is not committed.
            break
        rows.append(payload)
    return rows


def _append_fsynced_jsonl(path: Path, payload: Dict[str, Any]) -> None:
    durable_mkdir(path.parent)
    if path.exists():
        encoded = path.read_bytes()
        if encoded and not encoded.endswith(b"\n"):
            # Validate the committed prefix before discarding only the torn
            # tail. A corrupt interior record remains a hard error.
            _read_recoverable_jsonl(path)
            committed_length = encoded.rfind(b"\n") + 1
            with path.open("r+b") as handle:
                handle.truncate(committed_length)
                handle.flush()
                os.fsync(handle.fileno())
    row = (json.dumps(payload, sort_keys=True) + "\n").encode("utf-8")
    with path.open("ab") as handle:
        handle.write(row)
        handle.flush()
        os.fsync(handle.fileno())
    _fsync_directory(path.parent)


def _configured_stage_plan(stages: Sequence[str], *, target_environment: str) -> List[str]:
    cleaned = [str(stage or "").strip() for stage in (stages or [])]
    if any(not stage for stage in cleaned):
        raise ValueError("promotion_stages must not contain empty values")
    if len(set(cleaned)) != len(cleaned):
        raise ValueError("promotion_stages must not contain duplicate stages")
    if "draft" in cleaned:
        raise ValueError("draft is an initialization stage and cannot appear in promotion_stages")

    target = str(target_environment or "").strip()
    if target != RELEASE_STAGE_TOPOLOGY[-1]:
        raise ValueError("ordinary production contracts must target production")
    mandatory = list(RELEASE_STAGE_TOPOLOGY[1:])
    if cleaned and cleaned != mandatory:
        raise ValueError(
            "promotion_stages must exactly match build_verified -> canary_verified -> production"
        )
    return mandatory


class ProductionCompletionCriterion(BaseModel):
    model_config = ConfigDict(extra="forbid")

    criterion_id: str
    summary: str
    kind: str
    required: bool = True
    stage: Optional[str] = None
    artifact_id: Optional[str] = None
    world_state_key: Optional[str] = None
    expected_value: Optional[Any] = None
    allowed_values: List[str] = Field(default_factory=list)
    metadata: Dict[str, Any] = Field(default_factory=dict)

    @field_validator("criterion_id", "summary", "kind")
    @classmethod
    def _validate_non_empty(cls, value: str) -> str:
        text = str(value or "").strip()
        if not text:
            raise ValueError("must be non-empty")
        return text

    @field_validator("allowed_values")
    @classmethod
    def _validate_allowed_values(cls, values: List[str]) -> List[str]:
        cleaned = [str(value or "").strip() for value in (values or [])]
        if any(not value for value in cleaned):
            raise ValueError("allowed_values must not contain empty values")
        return cleaned


class ProductionBlockerRule(BaseModel):
    model_config = ConfigDict(extra="forbid")

    blocker_id: str
    summary: str
    source: str
    requires_human: bool = True
    terminal: bool = True
    owner: Optional[str] = None
    question_prefix: Optional[str] = None
    metadata_key: Optional[str] = None
    metadata_value: Optional[str] = None
    decision_title: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)

    @field_validator("blocker_id", "summary", "source")
    @classmethod
    def _validate_non_empty(cls, value: str) -> str:
        text = str(value or "").strip()
        if not text:
            raise ValueError("must be non-empty")
        return text


class ProductionCheckpointPolicy(BaseModel):
    model_config = ConfigDict(extra="forbid")

    report_every_iterations: int = 1
    report_on_stage_change: bool = True
    report_on_recovery: bool = True
    report_on_blocker_change: bool = True
    live_review_seconds: int = 300
    abnormal_idle_grace_seconds: int = 180
    proactive_report_seconds: int = 900
    blocker_followup_seconds: int = 300

    @field_validator(
        "report_every_iterations",
        "live_review_seconds",
        "abnormal_idle_grace_seconds",
        "proactive_report_seconds",
        "blocker_followup_seconds",
    )
    @classmethod
    def _validate_positive(cls, value: int) -> int:
        number = int(value or 0)
        if number <= 0:
            raise ValueError("checkpoint policy values must be positive")
        return number


class ProductionPassBudget(BaseModel):
    model_config = ConfigDict(extra="forbid")

    max_auto_chain_passes: int = 4
    max_stage_advances_per_pass: int = 1
    validation_mode: str = "focused"
    broaden_validation_on_stage_change: bool = True
    broaden_validation_on_completion_candidate: bool = True
    broader_validation_checkpoints: List[str] = Field(default_factory=list)

    @field_validator("max_auto_chain_passes", "max_stage_advances_per_pass")
    @classmethod
    def _validate_positive_budget(cls, value: int) -> int:
        number = int(value or 0)
        if number <= 0:
            raise ValueError("budget values must be positive")
        if number > 32:
            raise ValueError("budget values must not exceed the immutable limit of 32")
        return number

    @field_validator("validation_mode")
    @classmethod
    def _validate_validation_mode(cls, value: str) -> str:
        text = str(value or "").strip().lower()
        if text not in {"focused", "broad"}:
            raise ValueError("validation_mode must be 'focused' or 'broad'")
        return text

    @field_validator("broader_validation_checkpoints")
    @classmethod
    def _validate_checkpoints(cls, values: List[str]) -> List[str]:
        cleaned = [str(value or "").strip() for value in (values or [])]
        if any(not value for value in cleaned):
            raise ValueError("broader_validation_checkpoints must not contain empty values")
        return cleaned


class ProductionStageGate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    stage: str
    required_fencepost_stages: List[str] = Field(default_factory=list)
    required_artifacts: List[str] = Field(default_factory=list)
    required_handoff_count: int = 0
    allowed_active_agents: List[str] = Field(default_factory=list)
    allowed_lifecycle_states: List[str] = Field(default_factory=lambda: ["waiting", "running", "completed"])
    require_dependability: bool = True
    metadata: Dict[str, Any] = Field(default_factory=dict)

    @field_validator("stage")
    @classmethod
    def _validate_stage(cls, value: str) -> str:
        text = str(value or "").strip()
        if not text:
            raise ValueError("stage must be non-empty")
        return text

    @field_validator("required_handoff_count")
    @classmethod
    def _validate_handoff_count(cls, value: int) -> int:
        number = int(value or 0)
        if number < 0:
            raise ValueError("required_handoff_count must be non-negative")
        return number

    @field_validator("required_fencepost_stages", "required_artifacts", "allowed_active_agents", "allowed_lifecycle_states")
    @classmethod
    def _validate_rows(cls, values: List[str]) -> List[str]:
        cleaned = [str(value or "").strip() for value in (values or [])]
        if any(not value for value in cleaned):
            raise ValueError("list values must not contain empty rows")
        return cleaned


class ProductionBuildContract(BaseModel):
    model_config = ConfigDict(extra="forbid")

    contract_id: str = Field(default_factory=lambda: f"contract_{uuid4().hex[:16]}")
    process_id: str
    objective: str
    target_environment: str = "production"
    promotion_stages: List[str] = Field(default_factory=list)
    stage_gates: List[ProductionStageGate] = Field(default_factory=list)
    completion_criteria: List[ProductionCompletionCriterion] = Field(default_factory=list)
    blocker_rules: List[ProductionBlockerRule] = Field(default_factory=list)
    dependability_profile: str = "24h"
    controller_scope: str = "production_build_loop"
    controller_lease_seconds: int = 180
    worker_lease_seconds: int = 180
    checkpoint_policy: ProductionCheckpointPolicy = Field(default_factory=ProductionCheckpointPolicy)
    execution_budget: ProductionPassBudget = Field(default_factory=ProductionPassBudget)
    metadata: Dict[str, Any] = Field(default_factory=dict)

    @field_validator("contract_id", "process_id", "objective", "target_environment", "controller_scope")
    @classmethod
    def _validate_non_empty(cls, value: str) -> str:
        text = str(value or "").strip()
        if not text:
            raise ValueError("must be non-empty")
        return text

    @field_validator("promotion_stages")
    @classmethod
    def _validate_promotion_stages(cls, values: List[str]) -> List[str]:
        cleaned = [str(value or "").strip() for value in (values or [])]
        if any(not value for value in cleaned):
            raise ValueError("promotion_stages must not contain empty values")
        return cleaned

    @field_validator("dependability_profile", mode="before")
    @classmethod
    def _validate_server_dependability_policy(cls, value: Any) -> str:
        if not isinstance(value, str):
            raise ValueError("production dependability_profile must be a server-owned policy identifier")
        policy_id = value.strip().lower()
        try:
            build_unattended_profile(policy_id)
        except KeyError as exc:
            raise ValueError(f"unknown server-owned production dependability policy: {value}") from exc
        return policy_id

    @field_validator("controller_lease_seconds", "worker_lease_seconds")
    @classmethod
    def _validate_positive(cls, value: int) -> int:
        number = int(value or 0)
        if number <= 0:
            raise ValueError("lease seconds must be positive")
        return number

    @model_validator(mode="after")
    def _validate_mandatory_stage_topology(self) -> "ProductionBuildContract":
        _configured_stage_plan(self.promotion_stages, target_environment=self.target_environment)
        return self


class BuildLoopControllerOwner(BaseModel):
    model_config = ConfigDict(extra="forbid")

    controller_id: str
    session_id: str
    lease_id: str
    claimed_at: str
    heartbeat_at: str

    @field_validator("controller_id", "session_id", "lease_id", "claimed_at", "heartbeat_at")
    @classmethod
    def _validate_non_empty(cls, value: str) -> str:
        text = str(value or "").strip()
        if not text:
            raise ValueError("must be non-empty")
        return text


class ProductionBuildLoopState(BaseModel):
    model_config = ConfigDict(extra="forbid")

    loop_id: str = Field(default_factory=lambda: f"loop_{uuid4().hex[:16]}")
    contract_id: str
    process_id: str
    persistence_revision: int = 0
    status: str = "active"
    liveness: str = "live"
    terminal_state: Optional[str] = None
    iteration_count: int = 0
    checkpoint_count: int = 0
    recovery_count: int = 0
    controller: Optional[BuildLoopControllerOwner] = None
    current_revision_id: Optional[str] = None
    current_snapshot_id: Optional[str] = None
    current_stage: Optional[str] = None
    latest_report_id: Optional[str] = None
    last_checkpoint_at: Optional[str] = None
    last_progress_at: Optional[str] = None
    last_report_at: Optional[str] = None
    next_review_at: Optional[str] = None
    last_watchdog_at: Optional[str] = None
    true_blockers: List[Dict[str, Any]] = Field(default_factory=list)
    completion: Dict[str, Any] = Field(default_factory=dict)
    next_action: Dict[str, Any] = Field(default_factory=dict)
    continuation: Dict[str, Any] = Field(default_factory=dict)
    last_pass: Dict[str, Any] = Field(default_factory=dict)
    last_progress: Dict[str, Any] = Field(default_factory=dict)
    last_report: Dict[str, Any] = Field(default_factory=dict)
    owed_follow_up: Dict[str, Any] = Field(default_factory=dict)
    reporting_cadence: Dict[str, Any] = Field(default_factory=dict)
    last_watchdog_decision: Dict[str, Any] = Field(default_factory=dict)
    conversation_ownership: Dict[str, Any] = Field(default_factory=dict)
    follow_through: Dict[str, Any] = Field(default_factory=dict)
    metadata: Dict[str, Any] = Field(default_factory=dict)

    @field_validator("loop_id", "contract_id", "process_id", "status", "liveness")
    @classmethod
    def _validate_non_empty(cls, value: str) -> str:
        text = str(value or "").strip()
        if not text:
            raise ValueError("must be non-empty")
        return text

    @field_validator("persistence_revision", "iteration_count", "checkpoint_count", "recovery_count")
    @classmethod
    def _validate_non_negative(cls, value: int) -> int:
        number = int(value or 0)
        if number < 0:
            raise ValueError("counts must be non-negative")
        return number


class ProductionBuildLoopReport(BaseModel):
    model_config = ConfigDict(extra="forbid")

    report_id: str = Field(default_factory=lambda: f"report_{uuid4().hex[:16]}")
    loop_id: str
    contract_id: str
    process_id: str
    iteration: int
    kind: str
    status: str
    summary: str
    recorded_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"))
    controller_id: Optional[str] = None
    controller_session_id: Optional[str] = None
    stage: Optional[str] = None
    actions_taken: List[Dict[str, Any]] = Field(default_factory=list)
    blockers: List[Dict[str, Any]] = Field(default_factory=list)
    completion: Dict[str, Any] = Field(default_factory=dict)
    metadata: Dict[str, Any] = Field(default_factory=dict)

    @field_validator("report_id", "loop_id", "contract_id", "process_id", "kind", "status", "summary", "recorded_at")
    @classmethod
    def _validate_non_empty(cls, value: str) -> str:
        text = str(value or "").strip()
        if not text:
            raise ValueError("must be non-empty")
        return text

    @field_validator("iteration")
    @classmethod
    def _validate_iteration(cls, value: int) -> int:
        number = int(value or 0)
        if number < 0:
            raise ValueError("iteration must be non-negative")
        return number


class ProductionBuildLoopStore:
    def __init__(self, path: str | Path):
        self.path = Path(path)

    def _root(self) -> Path:
        return self.path if not self.path.suffix else self.path.parent / self.path.stem

    def _contract_target(self, process_id: str) -> Path:
        return self._root() / "contracts" / f"{process_id}.json"

    def _state_target(self, process_id: str) -> Path:
        return self._root() / "state" / f"{process_id}.json"

    def _history_target(self, process_id: str) -> Path:
        return self._root() / "history" / f"{process_id}.jsonl"

    def _report_target(self, process_id: str) -> Path:
        return self._root() / "reports" / f"{process_id}.jsonl"

    def _lock_target(self, process_id: str) -> Path:
        return self._root() / "locks" / f"{process_id}.lock"

    @contextmanager
    def _locked(self, process_id: str, *, exclusive: bool):
        target = self._lock_target(process_id)
        durable_mkdir(target.parent)
        with target.open("a+b") as handle:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX if exclusive else fcntl.LOCK_SH)
            try:
                yield
            finally:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)

    def save_contract(self, contract: ProductionBuildContract | Dict[str, Any]) -> ProductionBuildContract:
        record = _contract_validate(contract if isinstance(contract, dict) else _contract_dump(contract))
        with self._locked(record.process_id, exclusive=True):
            target = self._contract_target(record.process_id)
            current = None
            if target.exists():
                current = _contract_validate(json.loads(target.read_text(encoding="utf-8")))
            if current is not None and current.contract_id != record.contract_id:
                raise RuntimeError(
                    "production build contract identity conflict: "
                    f"stored={current.contract_id}, received={record.contract_id}"
                )
            payload = _contract_dump(record)
            encoded = encoded_json(payload, pretty=True)
            with runtime_delivery_quota_transaction(self._root().parent):
                assert_process_count(
                    self._root(),
                    record.process_id,
                    delivery_root=self._root().parent,
                )
                assert_runtime_delivery_capacity(
                    delivery_root=self._root().parent,
                    store_root=self._root(),
                    process_id=record.process_id,
                    object_bytes=len(encoded),
                    additional_bytes=len(encoded),
                    replacing=target,
                )
                _atomic_write_json(target, payload)
            return record

    def load_contract(self, process_id: str) -> Optional[ProductionBuildContract]:
        target = self._contract_target(process_id)
        if not target.exists():
            return None
        return _contract_validate(json.loads(target.read_text(encoding="utf-8")))

    def save_state(self, state: ProductionBuildLoopState | Dict[str, Any]) -> ProductionBuildLoopState:
        record = _state_validate(state if isinstance(state, dict) else _state_dump(state))
        with self._locked(record.process_id, exclusive=True):
            target = self._state_target(record.process_id)
            current = self._load_state_unlocked(record.process_id)
            expected_revision = int(record.persistence_revision or 0)
            if current is None:
                if expected_revision != 0:
                    raise RuntimeError("production build loop persistence revision conflict")
                next_revision = 1
            else:
                if current.loop_id != record.loop_id or current.contract_id != record.contract_id:
                    raise RuntimeError("production build loop identity conflict")
                if expected_revision != current.persistence_revision:
                    raise RuntimeError("production build loop persistence revision conflict")
                next_revision = current.persistence_revision + 1
            record = _state_validate({**_state_dump(record), "persistence_revision": next_revision})
            state_payload = _state_dump(record)
            history_row = {
                "ts": _now_iso(),
                "loop_id": record.loop_id,
                "contract_id": record.contract_id,
                "process_id": record.process_id,
                "persistence_revision": record.persistence_revision,
                "status": record.status,
                "iteration_count": record.iteration_count,
                "checkpoint_count": record.checkpoint_count,
                "recovery_count": record.recovery_count,
                "previous_status": current.status if current else None,
                "state": state_payload,
            }
            history_target = self._history_target(record.process_id)
            state_encoded = encoded_json(state_payload, pretty=True)
            history_encoded = encoded_json(history_row)
            with runtime_delivery_quota_transaction(self._root().parent):
                history_payload = bounded_jsonl_payload(
                    history_target,
                    history_row,
                    max_records=MAX_HISTORY_RECORDS,
                    max_bytes=MAX_HISTORY_BYTES,
                )
                assert_runtime_delivery_capacity(
                    delivery_root=self._root().parent,
                    store_root=self._root(),
                    process_id=record.process_id,
                    object_bytes=max(len(state_encoded), len(history_encoded)),
                    additional_bytes=len(state_encoded) + len(history_payload),
                    replacements=(
                        (target, len(state_encoded)),
                        (history_target, len(history_payload)),
                    ),
                )
                _atomic_write_json(target, state_payload)
                append_bounded_jsonl(
                    history_target,
                    history_row,
                    max_records=MAX_HISTORY_RECORDS,
                    max_bytes=MAX_HISTORY_BYTES,
                )
            return record

    def _load_state_unlocked(self, process_id: str) -> Optional[ProductionBuildLoopState]:
        target = self._state_target(process_id)
        if not target.exists():
            return None
        try:
            return _state_validate(json.loads(target.read_text(encoding="utf-8")))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError, ValidationError, ValueError):
            # Pre-hardening direct writes could leave the projection truncated.
            # Recover the newest committed snapshot from the fsynced history so
            # durable rollback intent recovery can continue on startup.
            for row in reversed(_read_recoverable_jsonl(self._history_target(process_id))):
                state = row.get("state")
                if not isinstance(state, dict):
                    continue
                try:
                    return _state_validate(state)
                except (ValidationError, ValueError, TypeError):
                    continue
            return None

    def load_state(self, process_id: str) -> Optional[ProductionBuildLoopState]:
        with self._locked(process_id, exclusive=False):
            return self._load_state_unlocked(process_id)

    def append_report(self, report: ProductionBuildLoopReport | Dict[str, Any]) -> ProductionBuildLoopReport:
        record = _report_validate(report if isinstance(report, dict) else _report_dump(report))
        with self._locked(record.process_id, exclusive=True):
            target = self._report_target(record.process_id)
            payload = _report_dump(record)
            encoded = encoded_json(payload)
            with runtime_delivery_quota_transaction(self._root().parent):
                report_payload = bounded_jsonl_payload(
                    target,
                    payload,
                    max_records=MAX_REPORT_RECORDS,
                    max_bytes=MAX_REPORT_BYTES,
                )
                assert_runtime_delivery_capacity(
                    delivery_root=self._root().parent,
                    store_root=self._root(),
                    process_id=record.process_id,
                    object_bytes=len(encoded),
                    additional_bytes=len(report_payload),
                    replacements=((target, len(report_payload)),),
                )
                append_bounded_jsonl(
                    target,
                    payload,
                    max_records=MAX_REPORT_RECORDS,
                    max_bytes=MAX_REPORT_BYTES,
                )
        return record

    def reports(self, process_id: str) -> List[ProductionBuildLoopReport]:
        target = self._report_target(process_id)
        return [_report_validate(row) for row in _read_recoverable_jsonl(target)]



def _contract_validate(data: Dict[str, Any]) -> ProductionBuildContract:
    if hasattr(ProductionBuildContract, "model_validate"):
        return ProductionBuildContract.model_validate(data)
    return ProductionBuildContract.parse_obj(data)



def _contract_dump(model: ProductionBuildContract) -> Dict[str, Any]:
    if hasattr(model, "model_dump"):
        return model.model_dump()
    return model.dict()



def _state_validate(data: Dict[str, Any]) -> ProductionBuildLoopState:
    if hasattr(ProductionBuildLoopState, "model_validate"):
        return ProductionBuildLoopState.model_validate(data)
    return ProductionBuildLoopState.parse_obj(data)



def _state_dump(model: ProductionBuildLoopState) -> Dict[str, Any]:
    if hasattr(model, "model_dump"):
        return model.model_dump()
    return model.dict()



def _report_validate(data: Dict[str, Any]) -> ProductionBuildLoopReport:
    if hasattr(ProductionBuildLoopReport, "model_validate"):
        return ProductionBuildLoopReport.model_validate(data)
    return ProductionBuildLoopReport.parse_obj(data)



def _report_dump(model: ProductionBuildLoopReport) -> Dict[str, Any]:
    if hasattr(model, "model_dump"):
        return model.model_dump()
    return model.dict()



def _now(now: Optional[datetime] = None) -> datetime:
    return now or datetime.now(timezone.utc)


def _promotion_lease_margin_seconds() -> float:
    try:
        configured = float(os.getenv("CORTEX_PROMOTION_LEASE_MIN_REMAINING_SECONDS", "1"))
    except ValueError:
        configured = 1.0
    return min(max(configured, 1.0), 60.0)



def _now_iso(now: Optional[datetime] = None) -> str:
    return _now(now).isoformat(timespec="milliseconds").replace("+00:00", "Z")



def _parse_dt(value: Optional[str]) -> Optional[datetime]:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).astimezone(timezone.utc)
    except Exception:
        return None



def _iso_after_seconds(seconds: int | float, *, now: Optional[datetime] = None) -> str:
    return _now_iso(_now(now) + timedelta(seconds=max(0.0, float(seconds or 0.0))))



def _dedupe_rows(rows: Sequence[str]) -> List[str]:
    out: List[str] = []
    for row in rows or []:
        text = str(row or "").strip()
        if text and text not in out:
            out.append(text)
    return out


def _persistence_rows_digest(rows: Sequence[Any]) -> str:
    payload = [
        row.model_dump() if hasattr(row, "model_dump") else row.dict() if hasattr(row, "dict") else row
        for row in rows
    ]
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str).encode("utf-8")
    ).hexdigest()



def _policy_dump(model: Any) -> Dict[str, Any]:
    if model is None:
        return {}
    return model.model_dump() if hasattr(model, "model_dump") else model.dict()


def _blocker_requires_human(blocker: Optional[Dict[str, Any]]) -> bool:
    return bool((blocker or {}).get("requires_human"))


def _has_human_blockers(blockers: Sequence[Dict[str, Any]]) -> bool:
    return any(_blocker_requires_human(row) for row in blockers)


def _conversation_metadata(metadata: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    source = dict(metadata or {})
    owner = str(source.get("conversation_owner") or source.get("owner") or "").strip() or None
    session_key = str(source.get("conversation_session_key") or source.get("session_key") or "").strip() or None
    channel = str(source.get("conversation_channel") or source.get("channel") or "").strip() or None
    conversation_id = str(source.get("conversation_id") or source.get("thread_id") or source.get("chat_id") or "").strip() or None
    return {
        "owner": owner,
        "session_key": session_key,
        "channel": channel,
        "conversation_id": conversation_id,
    }


def _production_conversation_ownership(
    *,
    contract: "ProductionBuildContract",
    previous_state: Optional["ProductionBuildLoopState"],
    review_plan: Dict[str, Any],
    report_record: Optional["ProductionBuildLoopReport"],
    now_iso: str,
) -> Dict[str, Any]:
    previous = dict(previous_state.conversation_ownership or {}) if previous_state is not None else {}
    conversation = {
        **previous,
        **_conversation_metadata(contract.metadata),
    }
    owed_follow_up = dict(review_plan.get("owed_follow_up") or {})
    conversation.update(
        {
            "owned": bool(conversation.get("owner") or conversation.get("session_key") or conversation.get("conversation_id")),
            "owes_follow_up": bool(owed_follow_up.get("owed")),
            "follow_up_kind": owed_follow_up.get("kind"),
            "follow_up_reason": owed_follow_up.get("reason"),
            "next_follow_up_at": owed_follow_up.get("due_at"),
            "last_user_visible_update_at": report_record.recorded_at if report_record is not None else previous.get("last_user_visible_update_at"),
            "updated_at": now_iso,
        }
    )
    return conversation


def _production_follow_through(
    *,
    previous_state: Optional["ProductionBuildLoopState"],
    status: str,
    next_action: Dict[str, Any],
    continuation: Dict[str, Any],
    review_plan: Dict[str, Any],
    report_reasons: Sequence[str],
    report_record: Optional["ProductionBuildLoopReport"],
    watchdog_context: Optional[Dict[str, Any]],
    now_iso: str,
) -> Dict[str, Any]:
    previous = dict(previous_state.follow_through or {}) if previous_state is not None else {}
    owed_follow_up = dict(review_plan.get("owed_follow_up") or {})
    last_user_visible_update_intent = dict(previous.get("last_user_visible_update_intent") or {})
    if report_record is not None:
        last_user_visible_update_intent = {
            "kind": report_record.kind,
            "status": report_record.status,
            "summary": report_record.summary,
            "reasons": list((report_record.metadata or {}).get("reasons") or []),
            "recorded_at": report_record.recorded_at,
        }

    pending_update_intent = dict(previous.get("pending_update_intent") or {})
    if owed_follow_up.get("owed"):
        pending_update_intent = {
            "kind": owed_follow_up.get("kind") or "status",
            "reason": owed_follow_up.get("reason") or continuation.get("reason") or next_action.get("kind") or status,
            "due_at": owed_follow_up.get("due_at"),
            "status": status,
            "watchdog_decision": (watchdog_context or {}).get("decision"),
        }
    elif report_record is not None or status == "completed":
        pending_update_intent = {}

    return {
        **previous,
        "live_objective": status != "completed",
        "continuation": dict(continuation or {}),
        "next_action": dict(next_action or {}),
        "last_user_visible_update_intent": last_user_visible_update_intent,
        "pending_update_intent": pending_update_intent,
        "last_user_visible_update_at": report_record.recorded_at if report_record is not None else previous.get("last_user_visible_update_at"),
        "next_required_update_at": owed_follow_up.get("due_at"),
        "next_required_review_at": review_plan.get("next_review_at"),
        "review_due": bool(review_plan.get("review_due")),
        "report_due": bool(review_plan.get("report_due")),
        "resume_on_next_tick": bool(status != "completed" and continuation.get("mode") in {"continue_now", "await_external_progress"}),
        "report_reasons": _dedupe_rows(list(report_reasons or [])),
        "watchdog": dict(watchdog_context or {}),
        "updated_at": now_iso,
    }


HUMAN_BLOCKER_HINTS: Dict[str, str] = {
    "approve": "ambiguity",
    "approval": "ambiguity",
    "decision": "ambiguity",
    "choose": "ambiguity",
    "clarify": "ambiguity",
    "confirm": "ambiguity",
    "unclear": "ambiguity",
    "ambigu": "ambiguity",
    "access": "access",
    "credential": "access",
    "secret": "access",
    "token": "access",
    "permission": "access",
    "auth": "access",
    "login": "access",
    "safety": "safety",
    "unsafe": "safety",
    "risk": "safety",
    "legal": "safety",
    "policy": "safety",
    "compliance": "safety",
}
HUMAN_BLOCKER_CLASSES = {"ambiguity", "access", "safety", "release_hold", "human_decision"}



def _report_blocker_key(blocker: Dict[str, Any]) -> str:
    return f"{blocker.get('source')}|{blocker.get('summary')}"



def _int_budget(value: Any, *, default: int = 0) -> int:
    try:
        return max(0, int(value or 0))
    except Exception:
        return default



def _classify_blocker_need(*, source: str, summary: str, requires_human: bool, metadata: Optional[Dict[str, Any]] = None) -> tuple[bool, Optional[str]]:
    text = str(summary or "").strip().lower()
    source_key = str(source or "").strip().lower()
    meta = dict(metadata or {})
    category = str(
        meta.get("blocker_class")
        or meta.get("classification")
        or meta.get("category")
        or meta.get("kind")
        or ""
    ).strip().lower()
    if source_key == "release_hold":
        return True, "release_hold"
    if source_key == "open_decision":
        return True, category or "human_decision"
    if category in HUMAN_BLOCKER_CLASSES:
        return True, category
    for hint, blocker_class in HUMAN_BLOCKER_HINTS.items():
        if hint in text:
            return True, blocker_class
    return bool(requires_human), (category or "human_decision") if requires_human else None



def _question_requires_human(question: str) -> tuple[bool, Optional[str]]:
    text = str(question or "").strip()
    upper = text.upper()
    if upper.startswith("HUMAN:"):
        return True, "human_decision"
    if not upper.startswith("BLOCKER:"):
        return False, None
    trimmed = text.split(":", 1)[1] if ":" in text else text
    return _classify_blocker_need(source="open_question", summary=trimmed, requires_human=False)



def _true_blocker_payload(
    payload: Dict[str, Any],
    *,
    source: Optional[str] = None,
    summary: Optional[str] = None,
    default_requires_human: bool = False,
) -> Optional[JsonDict]:
    blocker = dict(payload or {})
    blocker_source = str(source or blocker.get("source") or "runtime_blocker").strip() or "runtime_blocker"
    blocker_summary = str(summary or blocker.get("summary") or "").strip()
    if not blocker_summary:
        return None
    requires_human, blocker_class = _classify_blocker_need(
        source=blocker_source,
        summary=blocker_summary,
        requires_human=bool(blocker.get("requires_human", default_requires_human)),
        metadata=blocker.get("metadata") if isinstance(blocker.get("metadata"), dict) else None,
    )
    if not requires_human:
        return None
    blocker["source"] = blocker_source
    blocker["summary"] = blocker_summary
    blocker["requires_human"] = True
    blocker["terminal"] = bool(blocker.get("terminal", True))
    blocker["blocker_class"] = blocker_class or blocker.get("blocker_class") or "human_decision"
    return blocker



def _production_validation_decision(
    contract: "ProductionBuildContract",
    *,
    budget: "ProductionPassBudget",
    previous_state: Optional["ProductionBuildLoopState"],
    state: "ProductionBuildLoopState",
    stage_changes: Sequence[Dict[str, Any]],
) -> Dict[str, Any]:
    reasons: List[str] = []
    scope = "focused"
    if budget.validation_mode == "broad":
        scope = "broad"
        reasons.append("forced_broad_mode")
    elif budget.broaden_validation_on_completion_candidate and state.current_stage == contract.target_environment:
        scope = "broad"
        reasons.append("completion_checkpoint")
    elif budget.broaden_validation_on_stage_change and stage_changes:
        scope = "broad"
        reasons.append("stage_promotion_checkpoint")
    else:
        checkpoints = set(_dedupe_rows(list(budget.broader_validation_checkpoints or []) + [contract.target_environment]))
        if state.current_stage in checkpoints:
            scope = "broad"
            reasons.append(f"checkpoint:{state.current_stage}")
        else:
            reasons.append("bounded_pass_focused_validation")
    if previous_state is not None and previous_state.status in {"blocked", "completed"}:
        reasons.append(f"previous_status={previous_state.status}")
    return {
        "scope": scope,
        "reasons": _dedupe_rows(reasons),
        "promotion_checkpoint": scope == "broad",
        "stage_change_count": len(stage_changes or []),
        "current_stage": state.current_stage,
        "default_scope": budget.validation_mode,
    }



def _production_validation_scope(
    contract: "ProductionBuildContract",
    *,
    budget: "ProductionPassBudget",
    previous_state: Optional["ProductionBuildLoopState"],
    state: "ProductionBuildLoopState",
    blockers: Sequence[Dict[str, Any]],
    stage_changes: Sequence[Dict[str, Any]],
) -> str:
    del blockers
    return str(
        _production_validation_decision(
            contract,
            budget=budget,
            previous_state=previous_state,
            state=state,
            stage_changes=stage_changes,
        ).get("scope")
        or "focused"
    )



def _production_next_action(
    contract: "ProductionBuildContract",
    *,
    state: "ProductionBuildLoopState",
    blockers: Sequence[Dict[str, Any]],
    completion: Dict[str, Any],
    budget: "ProductionPassBudget",
    pass_index: int,
    next_stage: Optional[str],
    snapshot: Optional[ProcessSnapshot],
    budget_exhausted: bool,
    release_gate: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    budget_payload = budget.model_dump() if hasattr(budget, "model_dump") else budget.dict()
    if bool(completion.get("all_required_satisfied")) and not blockers:
        return {
            "kind": "completed",
            "status": "completed",
            "summary": f"Production build loop complete for {contract.process_id}",
            "pass_index": pass_index,
            "budget": budget_payload,
        }
    if blockers:
        if _has_human_blockers(blockers):
            return {
                "kind": "needs_human_decision",
                "status": "blocked",
                "summary": str(blockers[0].get("summary") or "Human decision required"),
                "blockers": [dict(row) for row in blockers],
                "pass_index": pass_index,
                "budget": budget_payload,
            }
        return {
            "kind": "await_non_human_recovery",
            "status": "active",
            "summary": str(blockers[0].get("summary") or "Production delivery awaiting non-human recovery"),
            "blockers": [dict(row) for row in blockers],
            "pass_index": pass_index,
            "budget": budget_payload,
        }
    if next_stage:
        gate_checks = dict((release_gate or {}).get("checks") or {})
        if release_gate is not None and not bool(release_gate.get("safe_push")) and not gate_checks.get("handoff_receipts_ok", True):
            return {
                "kind": "await_release_approval",
                "status": "active",
                "stage": next_stage,
                "summary": f"Await independent recipient approval for {next_stage}",
                "pass_index": pass_index,
                "budget": budget_payload,
            }
        return {
            "kind": "promote_stage",
            "status": "active",
            "stage": next_stage,
            "summary": f"Promote release toward {next_stage}",
            "pass_index": pass_index,
            "budget_exhausted": bool(budget_exhausted),
            "budget": budget_payload,
        }
    if snapshot is not None and str(snapshot.lifecycle_state or "") != "completed":
        return {
            "kind": "await_worker_progress",
            "status": "active",
            "lifecycle_state": snapshot.lifecycle_state,
            "summary": f"Await production worker progress for lifecycle={snapshot.lifecycle_state}",
            "pass_index": pass_index,
            "budget": budget_payload,
        }
    return {
        "kind": "await_validation_evidence",
        "status": "active",
        "summary": f"Await broader validation evidence for {contract.process_id}",
        "pass_index": pass_index,
        "budget": budget_payload,
    }



def _production_continuation(*, status: str, blockers: Sequence[Dict[str, Any]], next_action: Dict[str, Any]) -> Dict[str, Any]:
    if status == "completed":
        return {"mode": "stop", "terminal": True, "reason": "completed", "status": status}
    if blockers:
        if _has_human_blockers(blockers):
            return {"mode": "stop", "terminal": True, "reason": "needs_human_decision", "status": status}
        return {"mode": "await_external_progress", "terminal": False, "reason": "non_human_blocker", "status": status}
    next_kind = str(next_action.get("kind") or "").strip()
    if next_kind == "promote_stage":
        return {"mode": "continue_now", "terminal": False, "reason": next_kind, "status": status}
    return {"mode": "await_external_progress", "terminal": False, "reason": next_kind or "await_external_progress", "status": status}



def _production_progress_record(
    *,
    contract: "ProductionBuildContract",
    previous_state: Optional["ProductionBuildLoopState"],
    status: str,
    stage: Optional[str],
    actions_taken: Sequence[Dict[str, Any]],
    report_reasons: Sequence[str],
    next_action: Dict[str, Any],
    now_iso: str,
) -> tuple[Optional[str], Dict[str, Any]]:
    progress_actions = {
        "advance_release_stage",
        "capture_release_fencepost",
        "assign_worker_lease",
        "dispatch_resume_handoff",
        "resume_process",
        "record_dependability_cycle",
    }
    reasons: List[str] = []
    if previous_state is None:
        reasons.append("objective_started")
    if any(str((row or {}).get("action") or "") in progress_actions for row in actions_taken if isinstance(row, dict)):
        reasons.append("actions")
    if previous_state is not None and previous_state.current_stage != stage:
        reasons.append("stage_change")
    if previous_state is not None and previous_state.status != status:
        reasons.append("status_change")
    if any(reason in {"recovery", "idle_recovery", "stage_change", "status_change", "completed", "blocked", "human_blocker", "non_human_blocker"} for reason in report_reasons):
        reasons.append("reportable_change")
    if not reasons:
        return previous_state.last_progress_at if previous_state is not None else None, dict(previous_state.last_progress or {}) if previous_state is not None else {}
    return now_iso, {
        "recorded_at": now_iso,
        "status": status,
        "stage": stage,
        "reasons": _dedupe_rows(reasons),
        "summary": str(next_action.get("summary") or contract.objective),
        "action_types": _dedupe_rows([str((row or {}).get("action") or "") for row in actions_taken if isinstance(row, dict)]),
    }



def _production_review_plan(
    *,
    policy: ProductionCheckpointPolicy,
    previous_state: Optional["ProductionBuildLoopState"],
    status: str,
    blockers: Sequence[Dict[str, Any]],
    next_action: Dict[str, Any],
    continuation: Dict[str, Any],
    now: Optional[datetime],
    report_reasons: Sequence[str],
    watchdog_context: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    current_time = _now(now)
    now_iso = _now_iso(current_time)
    previous_next_review = _parse_dt(previous_state.next_review_at if previous_state is not None else None)
    previous_last_report = _parse_dt(previous_state.last_report_at if previous_state is not None else None)
    review_due = previous_next_review is not None and previous_next_review <= current_time
    next_kind = str(next_action.get("kind") or "")
    if status == "completed":
        return {
            "liveness": "terminal",
            "terminal_state": "completed",
            "next_review_at": None,
            "report_due": False,
            "review_due": review_due,
            "owed_follow_up": {"owed": False, "status": status, "reason": "completed", "due_at": None, "updated_at": now_iso},
            "reporting_cadence": {"classification": "terminal", "report_interval_seconds": 0, "review_interval_seconds": 0, "updated_at": now_iso},
        }
    human_blockers = _has_human_blockers(blockers)
    classification = "waiting_human" if human_blockers else "waiting_recovery" if blockers else "continue_now" if continuation.get("mode") == "continue_now" else "waiting_worker" if next_kind == "await_worker_progress" else "await_validation"
    review_seconds = 0 if classification == "continue_now" else int(policy.blocker_followup_seconds if human_blockers else policy.live_review_seconds)
    report_seconds = int(policy.blocker_followup_seconds if human_blockers else policy.proactive_report_seconds)
    next_review_at = now_iso if review_seconds <= 0 else _iso_after_seconds(review_seconds, now=current_time)
    report_due = False
    if review_due and previous_last_report is not None:
        report_due = (current_time - previous_last_report).total_seconds() >= report_seconds
    elif review_due and previous_last_report is None:
        report_due = True
    if watchdog_context and str(watchdog_context.get("decision") or "") in {"report_status", "report_blocker", "auto_resume"}:
        if previous_last_report is None:
            report_due = True
        elif (current_time - previous_last_report).total_seconds() >= max(30, report_seconds // 2):
            report_due = True
    if any(reason in {"idle_recovery", "blocked", "completed", "recovery", "non_human_blocker", "human_blocker"} for reason in report_reasons):
        report_due = True
    return {
        "liveness": "live",
        "terminal_state": None,
        "next_review_at": next_review_at,
        "report_due": report_due,
        "review_due": review_due,
        "owed_follow_up": {
            "owed": True,
            "status": status,
            "reason": str(continuation.get("reason") or next_kind or status),
            "kind": "blocker" if human_blockers else "status",
            "due_at": next_review_at,
            "updated_at": now_iso,
            "classification": classification,
        },
        "reporting_cadence": {
            "classification": classification,
            "review_interval_seconds": review_seconds,
            "report_interval_seconds": report_seconds,
            "review_due": review_due,
            "updated_at": now_iso,
        },
    }



def _checkpoint_from_journal(
    *,
    process_id: str,
    snapshot_store: ProcessSnapshotStore,
    journal: ProcessJournal,
    metadata: Optional[Dict[str, Any]] = None,
    runtime_policy_overrides: Optional[Dict[str, Any]] = None,
    world_state_overrides: Optional[Dict[str, Any]] = None,
) -> ProcessSnapshot:
    previous = snapshot_store.load(process_id)
    replayed = replay_from_journal(journal, process_id)
    previous_metadata = dict(previous.metadata) if previous else {}
    checkpoint_count = int(previous_metadata.get("checkpoint_count", 0) or 0) + 1
    return snapshot_store.save(
        ProcessSnapshot(
            process_id=process_id,
            persistence_revision=previous.persistence_revision if previous else 0,
            last_event_id=replayed.get("last_event_id"),
            event_count=int(replayed.get("event_count", 0) or 0),
            lifecycle_state=str(replayed.get("lifecycle_state") or "created"),
            active_steps=list(replayed.get("active_steps") or []),
            waiting_steps=list(replayed.get("waiting_steps") or []),
            completed_steps=list(replayed.get("completed_steps") or []),
            failed_steps=list(replayed.get("failed_steps") or []),
            assigned_agents=dict(replayed.get("assigned_agents") or {}),
            runtime_policy={
                **dict(replayed.get("runtime_policy") or {}),
                **dict(runtime_policy_overrides or {}),
            },
            world_state={
                **dict(replayed.get("world_state") or {}),
                **dict(world_state_overrides or {}),
            },
            belief_refs=list(replayed.get("belief_refs") or []),
            artifact_refs=list(replayed.get("artifact_refs") or []),
            metadata={
                **previous_metadata,
                "checkpoint_count": checkpoint_count,
                **dict(metadata or {}),
            },
        )
    )



def _stage_plan(contract: ProductionBuildContract) -> List[str]:
    return _configured_stage_plan(
        contract.promotion_stages,
        target_environment=contract.target_environment,
    )



def _stage_rank_map(contract: ProductionBuildContract) -> Dict[str, int]:
    return {stage: idx for idx, stage in enumerate(_stage_plan(contract))}



def _release_artifact_ids(snapshot: ProcessSnapshot, release_state: Optional[ReleaseWorkflowState]) -> List[str]:
    release_artifacts = [
        str(row.get("artifact_id") or "")
        for row in ((release_state.metadata or {}).get("release_artifacts") or [])
        if isinstance(row, dict)
        and str(row.get("release_id") or "") == release_state.release_id
        and str(row.get("candidate_ref") or "") == release_state.candidate_ref
        and str(row.get("revision_id") or "") == release_state.revision_id
        and str(row.get("validation_outcome") or "") == "passed"
    ] if release_state else []
    # Snapshot artifact references are operational outputs, not signed release
    # receipts. They cannot satisfy production release criteria by themselves.
    return _dedupe_rows(release_artifacts)



def evaluate_production_completion(
    contract: ProductionBuildContract,
    *,
    snapshot: ProcessSnapshot,
    shared_state: SharedProcessState,
    dependability_report: Optional[JsonDict] = None,
    release_state: Optional[ReleaseWorkflowState] = None,
) -> JsonDict:
    if snapshot.process_id != contract.process_id or shared_state.process_id != contract.process_id:
        raise ValueError("completion evaluation requires matching process ids")

    rank_map = _stage_rank_map(contract)
    current_stage = str(release_state.current_stage or "").strip() if release_state else ""
    artifact_ids = set(_release_artifact_ids(snapshot, release_state))
    criteria_rows: List[JsonDict] = []

    for criterion in contract.completion_criteria:
        satisfied = False
        observed: Any = None
        detail: Optional[str] = None
        kind = criterion.kind
        if kind == "dependability":
            observed = bool((dependability_report or {}).get("success"))
            satisfied = bool(observed)
            detail = (dependability_report or {}).get("operator_summary")
        elif kind == "release_stage":
            target_stage = str(criterion.stage or criterion.expected_value or "").strip()
            comparison = str((criterion.metadata or {}).get("comparison") or "at_least").strip() or "at_least"
            observed = current_stage or None
            if current_stage and target_stage:
                if comparison == "equals":
                    satisfied = current_stage == target_stage
                else:
                    satisfied = rank_map.get(current_stage, -1) >= rank_map.get(target_stage, -1)
            detail = f"release stage {current_stage or 'missing'} vs {target_stage or 'unset'}"
        elif kind == "artifact_present":
            artifact_id = str(criterion.artifact_id or criterion.expected_value or "").strip()
            observed = artifact_id if artifact_id in artifact_ids else None
            satisfied = bool(observed)
            detail = f"artifact {'present' if satisfied else 'missing'}: {artifact_id}"
        elif kind == "open_questions_clear":
            observed = list(shared_state.open_questions)
            satisfied = len(shared_state.open_questions) == 0
            detail = f"open questions={len(shared_state.open_questions)}"
        elif kind == "operator_holds_clear":
            holds = list(release_state.operator_holds) if release_state else []
            observed = holds
            satisfied = len(holds) == 0
            detail = f"operator holds={len(holds)}"
        elif kind == "world_state":
            key = str(criterion.world_state_key or "").strip()
            observed = shared_state.world_state.get(key, snapshot.world_state.get(key)) if key else None
            allowed_values = list(criterion.allowed_values or [])
            if allowed_values:
                satisfied = str(observed) in allowed_values
            else:
                satisfied = observed == criterion.expected_value
            detail = f"world state {key}={observed!r}"
        elif kind == "lifecycle_state":
            observed = snapshot.lifecycle_state
            allowed_values = list(criterion.allowed_values or [])
            if allowed_values:
                satisfied = snapshot.lifecycle_state in allowed_values
            else:
                expected = str(criterion.expected_value or criterion.stage or "").strip()
                satisfied = snapshot.lifecycle_state == expected
            detail = f"lifecycle={snapshot.lifecycle_state}"
        else:
            detail = f"unsupported criterion kind: {kind}"

        criteria_rows.append(
            {
                "criterion_id": criterion.criterion_id,
                "summary": criterion.summary,
                "kind": kind,
                "required": bool(criterion.required),
                "satisfied": bool(satisfied),
                "observed": observed,
                "detail": detail,
            }
        )

    required_rows = [row for row in criteria_rows if row.get("required")]
    satisfied_required = [row for row in required_rows if row.get("satisfied")]
    has_required_criteria = bool(required_rows)
    all_required_satisfied = has_required_criteria and len(required_rows) == len(satisfied_required)
    return {
        "process_id": contract.process_id,
        "current_stage": current_stage or None,
        "criteria": criteria_rows,
        "required_total": len(required_rows),
        "required_satisfied": len(satisfied_required),
        "all_required_satisfied": all_required_satisfied,
        "contract_valid": has_required_criteria,
        "contract_errors": [] if has_required_criteria else ["at least one required completion criterion is required"],
        "operator_summary": (
            f"completion {'ready' if all_required_satisfied else 'pending'} for {contract.process_id}: "
            f"{len(satisfied_required)}/{len(required_rows)} required criteria satisfied"
        ),
    }



def _decision_requires_human(decision: OpenDecision) -> bool:
    metadata = dict(decision.metadata or {})
    owner = str(decision.owner or "").strip().lower()
    return bool(metadata.get("requires_human") or metadata.get("blocking") or owner in {"human", "operator", "user"})



def detect_true_blockers(
    contract: ProductionBuildContract,
    *,
    snapshot: ProcessSnapshot,
    shared_state: SharedProcessState,
    release_state: Optional[ReleaseWorkflowState] = None,
) -> List[JsonDict]:
    del snapshot
    blockers: List[JsonDict] = []

    for hold in list(release_state.operator_holds) if release_state else []:
        blocker = _true_blocker_payload({"source": "release_hold", "summary": str(hold), "terminal": True}, default_requires_human=True)
        if blocker is not None:
            blockers.append(blocker)

    for decision in shared_state.open_decisions:
        if decision.status == "resolved":
            continue
        if _decision_requires_human(decision):
            blocker = _true_blocker_payload(
                {
                    "source": "open_decision",
                    "summary": decision.title,
                    "terminal": True,
                    "decision_id": decision.decision_id,
                    "metadata": dict(decision.metadata or {}),
                },
                default_requires_human=True,
            )
            if blocker is not None:
                blockers.append(blocker)

    for question in shared_state.open_questions:
        requires_human, blocker_class = _question_requires_human(str(question))
        if not requires_human:
            continue
        blockers.append(
            {
                "source": "open_question",
                "summary": str(question),
                "requires_human": True,
                "terminal": True,
                "blocker_class": blocker_class or "human_decision",
            }
        )

    for rule in contract.blocker_rules:
        if rule.source == "release_hold":
            for hold in list(release_state.operator_holds) if release_state else []:
                payload = _true_blocker_payload(
                    {
                        "source": rule.source,
                        "summary": str(hold),
                        "terminal": bool(rule.terminal),
                        "rule_id": rule.blocker_id,
                        "metadata": dict(rule.metadata or {}),
                        "requires_human": bool(rule.requires_human),
                    },
                    default_requires_human=bool(rule.requires_human),
                )
                if payload is not None:
                    blockers.append(payload)
        elif rule.source == "open_question_prefix":
            prefix = str(rule.question_prefix or "").strip()
            if not prefix:
                continue
            for question in shared_state.open_questions:
                if str(question).startswith(prefix):
                    payload = _true_blocker_payload(
                        {
                            "source": rule.source,
                            "summary": str(question),
                            "terminal": bool(rule.terminal),
                            "rule_id": rule.blocker_id,
                            "metadata": dict(rule.metadata or {}),
                            "requires_human": bool(rule.requires_human),
                        },
                        default_requires_human=bool(rule.requires_human),
                    )
                    if payload is not None:
                        blockers.append(payload)
        elif rule.source == "open_decision":
            for decision in shared_state.open_decisions:
                if decision.status == "resolved":
                    continue
                if rule.owner and str(decision.owner or "").strip() != str(rule.owner or "").strip():
                    continue
                if rule.decision_title and str(decision.title or "").strip() != str(rule.decision_title or "").strip():
                    continue
                if rule.metadata_key:
                    observed = (decision.metadata or {}).get(rule.metadata_key)
                    if rule.metadata_value is not None and str(observed) != str(rule.metadata_value):
                        continue
                    if rule.metadata_value is None and not observed:
                        continue
                payload = _true_blocker_payload(
                    {
                        "source": rule.source,
                        "summary": decision.title,
                        "terminal": bool(rule.terminal),
                        "decision_id": decision.decision_id,
                        "rule_id": rule.blocker_id,
                        "metadata": {**dict(rule.metadata or {}), **dict(decision.metadata or {})},
                        "requires_human": bool(rule.requires_human),
                    },
                    default_requires_human=bool(rule.requires_human),
                )
                if payload is not None:
                    blockers.append(payload)

    deduped: List[JsonDict] = []
    seen = set()
    for blocker in blockers:
        key = _report_blocker_key(blocker)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(blocker)
    return deduped



def _claim_controller(
    contract: ProductionBuildContract,
    *,
    previous_state: Optional[ProductionBuildLoopState],
    supervisor: AgentSupervisor,
    controller_id: str,
    controller_session_id: str,
    now: Optional[datetime] = None,
) -> JsonDict:
    scope = f"{contract.controller_scope}:{contract.process_id}"
    supervisor.reclaim_stale(process_id=contract.process_id)

    stale_scope_leases = [
        row
        for row in supervisor.list(process_id=contract.process_id, status="stale")
        if row.scope == scope
    ]
    actions: List[JsonDict] = []

    active_scope_leases = [
        row
        for row in supervisor.list(process_id=contract.process_id, status="active")
        if row.scope == scope
    ]
    lease: Optional[AgentLease] = None
    recovery = False

    for row in active_scope_leases:
        session = str((row.metadata or {}).get("session_id") or "").strip()
        if row.agent_id == controller_id and session == controller_session_id:
            lease = supervisor.heartbeat(row.lease_id, lease_seconds=contract.controller_lease_seconds)
            actions.append({"action": "heartbeat_controller", "lease_id": lease.lease_id})
            break

    if lease is None and active_scope_leases:
        row = active_scope_leases[0]
        lease = row
        actions.append(
            {
                "action": "controller_already_owned",
                "lease_id": row.lease_id,
                "owner": row.agent_id,
                "session_id": (row.metadata or {}).get("session_id"),
            }
        )
    elif lease is None:
        lease_metadata = {
                "session_id": controller_session_id,
                "contract_id": contract.contract_id,
                "objective": contract.objective,
        }
        if stale_scope_leases:
            stale, lease = supervisor.takeover_stale(
                stale_scope_leases[0].lease_id,
                agent_id=controller_id,
                lease_seconds=contract.controller_lease_seconds,
                metadata=lease_metadata,
            )
            actions.append(
                {
                    "action": "fenced_controller_takeover",
                    "lease_id": lease.lease_id,
                    "generation": lease.generation,
                    "superseded_lease_id": stale.lease_id,
                }
            )
            recovery = True
        else:
            lease = supervisor.assign(
                process_id=contract.process_id,
                scope=scope,
                agent_id=controller_id,
                lease_seconds=contract.controller_lease_seconds,
                metadata=lease_metadata,
            )
            actions.append({"action": "claim_controller", "lease_id": lease.lease_id, "generation": lease.generation})
        previous_session = str(previous_state.controller.session_id if previous_state and previous_state.controller else "").strip()
        if previous_session and previous_session != controller_session_id:
            recovery = True

    owner = BuildLoopControllerOwner(
        controller_id=lease.agent_id,
        session_id=str((lease.metadata or {}).get("session_id") or controller_session_id),
        lease_id=lease.lease_id,
        claimed_at=lease.assigned_at,
        heartbeat_at=lease.heartbeat_at,
    )
    return {
        "owner": owner,
        "actions": actions,
        "recovery": recovery,
        "owned_by_current_session": owner.controller_id == controller_id and owner.session_id == controller_session_id,
    }



_DEPENDABILITY_CAMPAIGN_CHECKS = {
    "policy_binding_ok",
    "campaign_binding_ok",
    "campaign_timestamps_ok",
    "campaign_continuity_ok",
    "elapsed_duration_ok",
    "campaign_cycles_ok",
}


def _production_dependability_binding(
    contract: ProductionBuildContract,
    *,
    shared_state: SharedProcessState,
    release_state: Optional[ReleaseWorkflowState],
) -> JsonDict:
    binding: JsonDict = {
        "contract_id": contract.contract_id,
        "revision_id": shared_state.revision_id,
    }
    if release_state is not None:
        binding.update(
            {
                "release_id": release_state.release_id,
                "candidate_ref": release_state.candidate_ref,
                "revision_id": release_state.revision_id,
            }
        )
    return binding


def _advance_production_dependability_campaign(
    contract: ProductionBuildContract,
    *,
    existing: Optional[JsonDict],
    binding: JsonDict,
    preliminary_report: JsonDict,
    snapshot: ProcessSnapshot,
    now: Optional[datetime] = None,
) -> tuple[JsonDict, List[JsonDict]]:
    """Record at most one genuine, scheduled observation cycle per server pass."""

    # `now` also drives deterministic watchdog/reconciliation behavior and can
    # originate in an operator request. It must never timestamp release soak
    # evidence; only the server clock may do that.
    current = _dependability_server_now()
    if current.tzinfo is None:
        raise ValueError("dependability campaign server time must be timezone-aware")
    current_monotonic = float(_dependability_server_monotonic())
    current_boot_id = _dependability_server_boot_id()
    if not math.isfinite(current_monotonic) or current_monotonic < 0:
        raise RuntimeError("dependability campaign monotonic clock is invalid")
    current_iso = _now_iso(current)
    profile_spec = build_unattended_profile(contract.dependability_profile)
    policy_digest = unattended_profile_digest(contract.dependability_profile)
    expected = {
        "process_id": contract.process_id,
        "policy_id": contract.dependability_profile,
        "policy_digest": policy_digest,
        **dict(binding),
    }
    campaign = dict(existing or {})
    actions: List[JsonDict] = []
    binding_matches = (
        bool(campaign)
        and campaign.get("schema_version") == DEPENDABILITY_CAMPAIGN_SCHEMA
        and all(
            str(campaign.get(key) or "") == str(value or "")
            for key, value in expected.items()
        )
    )
    static_healthy = all(
        bool(value)
        for name, value in dict(preliminary_report.get("checks") or {}).items()
        if name not in _DEPENDABILITY_CAMPAIGN_CHECKS
    )
    existing_receipts = list(campaign.get("cycle_receipts") or []) if isinstance(campaign.get("cycle_receipts"), list) else []
    continuity_reason: Optional[str] = None
    continuity_ok = False
    if binding_matches:
        try:
            started_at = datetime.fromisoformat(
                str(campaign["started_at"]).replace("Z", "+00:00")
            )
            previous_end = datetime.fromisoformat(
                str(campaign["observation_end_at"]).replace("Z", "+00:00")
            )
            started_monotonic = float(campaign["started_monotonic"])
            previous_end_monotonic = float(campaign["observation_end_monotonic"])
            if started_at.tzinfo is None or previous_end.tzinfo is None:
                raise ValueError
            monotonic_delta = current_monotonic - previous_end_monotonic
            wall_delta = (current - previous_end).total_seconds()
            total_monotonic = current_monotonic - started_monotonic
            total_wall = (current - started_at).total_seconds()
            if str(campaign.get("boot_id") or "") != current_boot_id:
                continuity_reason = "boot_identity_changed"
            elif (
                not all(
                    math.isfinite(value)
                    for value in (
                        started_monotonic,
                        previous_end_monotonic,
                        monotonic_delta,
                        total_monotonic,
                    )
                )
                or started_monotonic < 0
                or previous_end_monotonic < started_monotonic
                or monotonic_delta < 0
                or total_monotonic < 0
                or wall_delta < 0
                or total_wall < 0
            ):
                continuity_reason = "monotonic_discontinuity"
            elif (
                abs(wall_delta - monotonic_delta)
                > _dependability_clock_divergence_seconds()
                or abs(total_wall - total_monotonic)
                > _dependability_clock_divergence_seconds()
            ):
                continuity_reason = "wall_clock_divergence"
            else:
                continuity_ok = True
        except (KeyError, TypeError, ValueError):
            continuity_reason = "monotonic_evidence_invalid"

    campaign_complete = (
        binding_matches
        and continuity_ok
        and len(existing_receipts) >= int(profile_spec["campaign_cycles"])
    )
    recovered_from_unhealthy = bool(
        binding_matches
        and static_healthy
        and not campaign_complete
        and str(campaign.get("observation_status") or "") != "healthy"
    )
    if (
        not binding_matches
        or not continuity_ok
        or (not static_healthy and not campaign_complete)
        or recovered_from_unhealthy
    ):
        previous_campaign_id = str(campaign.get("campaign_id") or "") or None
        campaign = {
            "schema_version": DEPENDABILITY_CAMPAIGN_SCHEMA,
            "campaign_id": f"depcamp_{uuid4().hex[:20]}",
            **expected,
            "boot_id": current_boot_id,
            "started_at": current_iso,
            "started_monotonic": current_monotonic,
            "observation_end_at": current_iso,
            "observation_end_monotonic": current_monotonic,
            "observation_status": "healthy" if static_healthy else "unhealthy",
            "cycle_receipts": [],
        }
        actions.append(
            {
                "action": "start_dependability_campaign",
                "campaign_id": campaign["campaign_id"],
                "replaced_campaign_id": previous_campaign_id,
                "reason": (
                    "release_binding_changed"
                    if not binding_matches and existing
                    else continuity_reason
                    if continuity_reason
                    else "static_dependability_recovered"
                    if recovered_from_unhealthy
                    else "static_dependability_not_ready"
                    if not static_healthy
                    else "initial_campaign"
                ),
            }
        )
        if not static_healthy:
            return campaign, actions

    if not static_healthy:
        # A completed campaign is immutable historical evidence. A transient
        # current-health failure still blocks the report, but cannot erase the
        # genuine elapsed duration and cycle receipts already observed.
        return campaign, actions

    if campaign_complete:
        return campaign, actions

    campaign["observation_end_at"] = current_iso
    campaign["observation_end_monotonic"] = current_monotonic
    receipts = [dict(row) for row in list(campaign.get("cycle_receipts") or []) if isinstance(row, dict)]
    elapsed_seconds = max(
        0.0, current_monotonic - float(campaign["started_monotonic"])
    )
    required_cycles = int(profile_spec["campaign_cycles"])
    duration_seconds = float(profile_spec["intended_duration_hours"]) * 3600.0
    interval_seconds = duration_seconds / required_cycles
    current_slot = min(required_cycles, int(elapsed_seconds // interval_seconds)) if interval_seconds > 0 else required_cycles
    next_cycle = len(receipts) + 1
    if next_cycle <= required_cycles and current_slot > next_cycle:
        previous_campaign_id = str(campaign["campaign_id"])
        campaign = {
            "schema_version": DEPENDABILITY_CAMPAIGN_SCHEMA,
            "campaign_id": f"depcamp_{uuid4().hex[:20]}",
            **expected,
            "boot_id": current_boot_id,
            "started_at": current_iso,
            "started_monotonic": current_monotonic,
            "observation_end_at": current_iso,
            "observation_end_monotonic": current_monotonic,
            "observation_status": "healthy",
            "cycle_receipts": [],
        }
        actions.append(
            {
                "action": "start_dependability_campaign",
                "campaign_id": campaign["campaign_id"],
                "replaced_campaign_id": previous_campaign_id,
                "reason": "missed_observation_window",
            }
        )
        return campaign, actions
    if next_cycle <= required_cycles and current_slot == next_cycle:
        receipt = {
            "receipt_id": f"depcycle_{uuid4().hex[:20]}",
            "campaign_id": campaign["campaign_id"],
            "cycle_number": next_cycle,
            "boot_id": current_boot_id,
            "observed_at": current_iso,
            "observed_monotonic": current_monotonic,
            "snapshot_id": snapshot.snapshot_id,
            **expected,
        }
        receipts.append(receipt)
        campaign["cycle_receipts"] = receipts
        actions.append(
            {
                "action": "record_dependability_cycle",
                "campaign_id": campaign["campaign_id"],
                "receipt_id": receipt["receipt_id"],
                "cycle_number": next_cycle,
            }
        )
    return campaign, actions


def repair_production_dependability(
    contract: ProductionBuildContract,
    *,
    snapshot_store: ProcessSnapshotStore,
    shared_state_store: SharedProcessStateStore,
    journal: ProcessJournal,
    mailbox: AgentMailbox,
    supervisor: AgentSupervisor,
    controller_id: str,
    campaign_evidence: Optional[JsonDict] = None,
    evidence_binding: Optional[JsonDict] = None,
    now: Optional[datetime] = None,
) -> JsonDict:
    effective_now = _dependability_server_now() if isinstance(contract, ProductionBuildContract) else now
    before = load_dependability_report(
        process_id=contract.process_id,
        snapshot_store=snapshot_store,
        shared_state_store=shared_state_store,
        journal=journal,
        mailbox=mailbox,
        supervisor=supervisor,
        profile=contract.dependability_profile,
        campaign_evidence=campaign_evidence,
        evidence_binding=evidence_binding,
        now=effective_now,
    )
    actions_taken: List[JsonDict] = []
    if before.get("success"):
        return {
            "before": before,
            "after": before,
            "actions_taken": actions_taken,
            "repair_plan": compile_dependability_repair_plan(before),
            "success": True,
        }

    plan = compile_dependability_repair_plan(before)
    shared_state = shared_state_store.load(contract.process_id)
    current_revision_id = shared_state.revision_id if shared_state else None

    reclaimed = supervisor.reclaim_stale(process_id=contract.process_id)
    if reclaimed:
        actions_taken.append({"action": "reclaim_stale", "lease_ids": [row.lease_id for row in reclaimed if row.process_id == contract.process_id]})

    stale_leases = supervisor.list(process_id=contract.process_id, status="stale")
    if stale_leases:
        actions_taken.append(
            {
                "action": "stale_leases_require_fenced_takeover",
                "lease_ids": [row.lease_id for row in stale_leases],
                "blocking": True,
            }
        )

    dead_letters = mailbox.list(process_id=contract.process_id, delivery_statuses=["dead_letter"])
    recovered_ids: List[str] = []
    for row in dead_letters:
        recovered = mailbox.recover_dead_letter(
            row.message_id,
            revision_id=current_revision_id,
            recovery_reason="production_loop_revision_realign",
        )
        recovered_ids.append(recovered.message_id)
    if recovered_ids:
        actions_taken.append({"action": "recover_dead_letters", "message_ids": recovered_ids, "recipient_ack_required": True})

    if any(check in before.get("failing_checks", []) for check in ["checkpoint_freshness_ok", "snapshot_event_gap_ok", "replay_matches_snapshot"]):
        checkpoint = _checkpoint_from_journal(
            process_id=contract.process_id,
            snapshot_store=snapshot_store,
            journal=journal,
            metadata={"production_dependability_repaired": True},
            runtime_policy_overrides={"production_dependability_repaired": True},
            world_state_overrides={"production_dependability_repaired": True},
        )
        actions_taken.append({"action": "checkpoint_from_journal", "snapshot_id": checkpoint.snapshot_id})

    snapshot = snapshot_store.load(contract.process_id)
    shared_state = shared_state_store.load(contract.process_id)
    parity_failures = {"revision_head_ok", "replay_matches_shared_state"}.intersection(before.get("failing_checks", []))
    if snapshot and shared_state and parity_failures:
        history_count = len(shared_state_store.history(contract.process_id)) + 1
        refreshed = shared_state_store.save(
            SharedProcessState(
                process_id=contract.process_id,
                revision_id=f"{shared_state.revision_id}.parity{history_count}",
                goals=list(shared_state.goals),
                active_plan_node_ids=list(snapshot.active_steps or snapshot.waiting_steps or shared_state.active_plan_node_ids),
                open_decisions=list(shared_state.open_decisions),
                runtime_constraints=dict(shared_state.runtime_constraints),
                world_state={**dict(shared_state.world_state), **dict(snapshot.world_state)},
                belief_refs=_dedupe_rows(list(shared_state.belief_refs) + list(snapshot.belief_refs)),
                open_questions=list(shared_state.open_questions),
                agent_ownership={**dict(shared_state.agent_ownership), **dict(snapshot.assigned_agents)},
                operator_overrides=dict(shared_state.operator_overrides),
                metadata={**dict(shared_state.metadata), "parity_reconciled_by": controller_id},
            ),
            expected_revision_id=shared_state.revision_id,
            actor=controller_id,
            provenance={
                "scenario": "production_build_loop",
                "action": "reconcile_shared_state_parity",
                "failing_checks": sorted(parity_failures),
            },
        )
        actions_taken.append(
            {
                "action": "reconcile_shared_state_parity",
                "revision_id": refreshed.revision_id,
                "failing_checks": sorted(parity_failures),
            }
        )

    after = load_dependability_report(
        process_id=contract.process_id,
        snapshot_store=snapshot_store,
        shared_state_store=shared_state_store,
        journal=journal,
        mailbox=mailbox,
        supervisor=supervisor,
        profile=contract.dependability_profile,
        campaign_evidence=campaign_evidence,
        evidence_binding=evidence_binding,
        now=effective_now,
    )
    return {
        "before": before,
        "after": after,
        "actions_taken": actions_taken,
        "repair_plan": plan,
        "success": bool(after.get("success")),
    }



def recover_production_worker(
    contract: ProductionBuildContract,
    *,
    snapshot_store: ProcessSnapshotStore,
    shared_state_store: SharedProcessStateStore,
    journal: ProcessJournal,
    mailbox: AgentMailbox,
    supervisor: AgentSupervisor,
    controller_id: str,
) -> JsonDict:
    snapshot = snapshot_store.load(contract.process_id)
    shared_state = shared_state_store.load(contract.process_id)
    if snapshot is None or shared_state is None:
        raise ValueError("snapshot and shared state are required for worker recovery")

    node_candidates = _dedupe_rows(
        list(shared_state.active_plan_node_ids)
        + list(snapshot.waiting_steps)
        + list(snapshot.active_steps)
        + list(shared_state.agent_ownership.keys())
    )
    if not node_candidates:
        return {"recovered": False, "actions_taken": []}

    node_id = node_candidates[0]
    agent_id = (
        str(shared_state.agent_ownership.get(node_id) or "").strip()
        or str(snapshot.assigned_agents.get(node_id) or "").strip()
        or str((contract.metadata or {}).get("default_worker_id") or "").strip()
        or controller_id
    )

    actions_taken: List[JsonDict] = []
    active_scope_leases = [
        row
        for row in supervisor.list(process_id=contract.process_id, status="active")
        if row.scope == node_id
    ]
    stale_scope_leases = [
        row
        for row in supervisor.list(process_id=contract.process_id, status="stale")
        if row.scope == node_id
    ]
    if not active_scope_leases:
        if stale_scope_leases:
            return {
                "recovered": False,
                "actions_taken": [
                    {
                        "action": "worker_requires_fenced_takeover",
                        "node_id": node_id,
                        "lease_ids": [row.lease_id for row in stale_scope_leases],
                        "blocking": True,
                    }
                ],
            }
        lease = supervisor.assign(
            process_id=contract.process_id,
            scope=node_id,
            agent_id=agent_id,
            lease_seconds=contract.worker_lease_seconds,
            metadata={"recovered_by": controller_id, "objective": contract.objective},
        )
        actions_taken.append({"action": "assign_worker_lease", "lease_id": lease.lease_id, "node_id": node_id, "agent_id": agent_id})
    else:
        lease = active_scope_leases[0]

    handoff = mailbox.send(
        process_id=contract.process_id,
        from_agent=controller_id,
        to_agent=agent_id,
        kind="handoff",
        revision_id=shared_state.revision_id,
        dedupe_key=f"production_resume:{contract.process_id}:{shared_state.revision_id}:{node_id}",
        payload={
            "objective": contract.objective,
            "node_id": node_id,
            "loop_scope": contract.controller_scope,
            "lease_id": lease.lease_id,
            "lease_generation": lease.generation,
        },
        metadata={
            "lease_id": lease.lease_id,
            "lease_generation": lease.generation,
            "lease_scope": lease.scope,
        },
    )
    actions_taken.append({"action": "dispatch_resume_handoff", "message_id": handoff.message_id, "agent_id": agent_id})

    if snapshot.lifecycle_state in {"waiting", "blocked", "created", "rolled_back"}:
        latest = journal.latest(process_id=contract.process_id)
        parents = [latest.event_id] if latest is not None else []
        resumed = journal.append(
            process_id=contract.process_id,
            kind="process_resumed",
            actor=controller_id,
            revision_id=shared_state.revision_id,
            causal_parent_ids=parents,
            payload={"node_id": node_id, "recovery_reason": "worker_watchdog_resume"},
        )
        journal.append(
            process_id=contract.process_id,
            kind="agent_assigned",
            actor=controller_id,
            revision_id=shared_state.revision_id,
            causal_parent_ids=[resumed.event_id],
            payload={"node_id": node_id, "agent_id": agent_id, "scope": node_id},
        )
        journal.append(
            process_id=contract.process_id,
            kind="step_started",
            actor=controller_id,
            revision_id=shared_state.revision_id,
            causal_parent_ids=[resumed.event_id],
            payload={"node_id": node_id},
        )
        checkpoint = _checkpoint_from_journal(
            process_id=contract.process_id,
            snapshot_store=snapshot_store,
            journal=journal,
            metadata={"worker_watchdog_resumed": True, "worker_watchdog_node_id": node_id},
            world_state_overrides={"worker_watchdog_resumed": True, "worker_watchdog_node_id": node_id},
        )
        actions_taken.append({"action": "resume_process", "snapshot_id": checkpoint.snapshot_id, "node_id": node_id})

    return {"recovered": bool(actions_taken), "actions_taken": actions_taken}



def _stage_gate_for(contract: ProductionBuildContract, stage: str) -> ProductionStageGate:
    plan = _stage_plan(contract)
    stage_index = plan.index(stage) if stage in plan else 0
    prior_stages = plan[:stage_index]
    if stage == "canary_verified":
        prior_stages = _dedupe_rows(["build_verified"] + prior_stages)
    if stage == contract.target_environment:
        prior_stages = _dedupe_rows(["build_verified", "canary_verified"] + prior_stages)
    release_bundle = f"artifact_release_bundle:{contract.process_id}"
    smoke_report = f"artifact_smoke_report:{contract.process_id}"
    is_target = stage == contract.target_environment
    requires_independent_handoff = bool(
        stage_index > 0 or stage in {"canary_verified", contract.target_environment}
    )
    recipient = "release-manager" if is_target else "release-verifier"
    mandatory = ProductionStageGate(
        stage=stage,
        required_fencepost_stages=prior_stages,
        required_artifacts=[release_bundle] + ([smoke_report] if is_target else []),
        required_handoff_count=1 if requires_independent_handoff else 0,
        allowed_lifecycle_states=["waiting", "completed"] if requires_independent_handoff else ["waiting", "running", "completed"],
        require_dependability=True,
        metadata={
            "default_evidence_gate": True,
            **(
                {
                    "handoff": {
                        "to_agent": recipient,
                        "scope": f"release:{stage}",
                        "expected_output": f"Acknowledge revision-bound verification evidence for {stage}",
                        "relevant_artifact_ids": [release_bundle] + ([smoke_report] if is_target else []),
                    }
                }
                if requires_independent_handoff
                else {}
            ),
        },
    )
    configured = next((gate for gate in contract.stage_gates if gate.stage == stage), None)
    if configured is None:
        return mandatory
    mandatory_handoff = dict(mandatory.metadata.get("handoff") or {})
    configured_handoff = dict(configured.metadata.get("handoff") or {})
    metadata = {**dict(configured.metadata), **dict(mandatory.metadata)}
    if mandatory_handoff:
        metadata["handoff"] = {
            **mandatory_handoff,
            **configured_handoff,
            "to_agent": mandatory_handoff["to_agent"],
        }
    allowed_lifecycle = [
        value for value in mandatory.allowed_lifecycle_states
        if value in set(configured.allowed_lifecycle_states)
    ]
    return ProductionStageGate(
        stage=stage,
        required_fencepost_stages=_dedupe_rows(
            list(mandatory.required_fencepost_stages) + list(configured.required_fencepost_stages)
        ),
        required_artifacts=_dedupe_rows(
            list(mandatory.required_artifacts) + list(configured.required_artifacts)
        ),
        required_handoff_count=max(mandatory.required_handoff_count, configured.required_handoff_count),
        allowed_active_agents=_dedupe_rows(list(configured.allowed_active_agents)),
        allowed_lifecycle_states=allowed_lifecycle or list(mandatory.allowed_lifecycle_states),
        require_dependability=True,
        metadata=metadata,
    )


def ingest_production_release_artifact(
    *,
    release_store: ReleaseWorkflowStore,
    process_id: str,
    artifact_id: str,
    payload: Any,
    artifact_kind: str,
    producer: str,
    verifier: str,
    attestation_signature: str,
    validation_outcome: str = "passed",
    target_stage: Optional[str] = None,
    claims: Optional[Dict[str, Any]] = None,
    created_at: Optional[str] = None,
) -> JsonDict:
    """Ingest an externally verified output without trusting its claimed hash."""

    limits = release_artifact_storage_limits()
    encoded, content_hash = prepare_release_artifact(
        payload,
        max_bytes=limits.max_artifact_bytes,
    )
    release_store.assert_mutation_allowed(process_id, operation="release artifact ingestion")
    preflight_state = release_store.load(process_id)
    if preflight_state is None:
        raise KeyError(f"release workflow not found: {process_id}")
    receipt_created_at = str(created_at or _now_iso())

    def _receipt_for_state(state: ReleaseWorkflowState) -> ReleaseArtifactReceipt:
        return ReleaseArtifactReceipt(
            artifact_id=artifact_id,
            artifact_ref=content_hash,
            content_hash=content_hash,
            artifact_kind=artifact_kind,
            target_stage=target_stage,
            candidate_ref=state.candidate_ref,
            release_id=state.release_id,
            revision_id=state.revision_id,
            producer=producer,
            verifier=verifier,
            validation_outcome=validation_outcome,
            claims=dict(claims or {}),
            created_at=receipt_created_at,
            attestation_signature=attestation_signature,
        )

    # Authenticate against a read-only snapshot before even opening mutation
    # or publication locks. State and immutable-receipt checks are repeated
    # under the release transaction to close the snapshot race.
    record_release_artifact_receipt(
        preflight_state,
        _receipt_for_state(preflight_state),
        encoded_artifact=encoded,
    )
    with release_store.release_transaction(process_id):
        release_store.assert_mutation_allowed(process_id, operation="release artifact ingestion")
        state = release_store.load(process_id)
        if state is None:
            raise KeyError(f"release workflow not found: {process_id}")
        artifact_store = release_store.artifact_store()
        artifact_ref = content_hash
        receipt = _receipt_for_state(state)
        updated = record_release_artifact_receipt(
            state,
            receipt,
            encoded_artifact=encoded,
        )
        current_refs = [
            str(row.get("artifact_ref") or "")
            for row in list((state.metadata or {}).get("release_artifacts") or [])
            if isinstance(row, dict)
        ]
        with artifact_store.publication_transaction():
            artifact_store.prune_orphans(
                release_store.referenced_artifact_refs(),
                grace_seconds=limits.orphan_grace_seconds,
            )
            artifact_store.assert_release_capacity(
                current_refs,
                content_hash=content_hash,
                encoded_size=len(encoded),
                release_quota_bytes=limits.release_quota_bytes,
            )
            artifact_ref, content_hash, created = artifact_store.publish_prepared(
                encoded,
                content_hash,
                store_quota_bytes=limits.store_quota_bytes,
            )
            try:
                persisted = release_store.save(
                    updated,
                    actor=verifier,
                    provenance={
                        "scenario": "production_artifact_ingestion",
                        "artifact_id": artifact_id,
                        "content_hash": content_hash,
                        "verifier": verifier,
                    },
                )
            except BaseException:
                try:
                    durable_refs = release_store.referenced_artifact_refs()
                except Exception:
                    durable_refs = []
                if created and artifact_ref not in durable_refs:
                    artifact_store.remove_publication(artifact_ref)
                raise
    return {
        "state": persisted,
        "receipt": receipt,
        "artifact_ref": artifact_ref,
        "content_hash": content_hash,
    }



def _next_stage(contract: ProductionBuildContract, current_stage: Optional[str]) -> Optional[str]:
    plan = _stage_plan(contract)
    current = str(current_stage or "").strip()
    if not plan:
        return None
    if not current:
        return plan[0]
    if current not in plan:
        return plan[0]
    current_index = plan.index(current)
    return plan[current_index + 1] if current_index + 1 < len(plan) else None


def _maybe_dispatch_release_handoff(
    release_state: ReleaseWorkflowState,
    *,
    next_stage: str,
    gate_spec: ProductionStageGate,
    snapshot: ProcessSnapshot,
    shared_state: SharedProcessState,
    mailbox: AgentMailbox,
    supervisor: AgentSupervisor,
    controller_id: str,
) -> JsonDict:
    metadata = dict(gate_spec.metadata or {})
    handoff_config = metadata.get("handoff") if isinstance(metadata.get("handoff"), dict) else {}
    if not handoff_config:
        return {"state": release_state, "actions_taken": []}

    required_handoffs = max(1, int(gate_spec.required_handoff_count or 0))
    stage_records = [
        row
        for row in release_state.handoff_records
        if str(row.get("stage") or "").strip() == next_stage
        and str(row.get("revision_id") or "").strip() == shared_state.revision_id
        and str(row.get("release_id") or "").strip() == release_state.release_id
        and str(row.get("candidate_ref") or "").strip() == release_state.candidate_ref
    ]
    acked_count = sum(1 for row in stage_records if str(row.get("delivery_status") or "") == "acked")
    if acked_count >= required_handoffs:
        return {"state": release_state, "actions_taken": []}

    from_agent = str(handoff_config.get("from_agent") or controller_id).strip() or controller_id
    to_agent = str(handoff_config.get("to_agent") or controller_id).strip() or controller_id
    scope = str(handoff_config.get("scope") or f"release:{release_state.current_stage or 'draft'}:{next_stage}").strip()
    objective = str(handoff_config.get("objective") or f"Promote release candidate from {release_state.current_stage} to {next_stage}").strip()
    expected_output = str(handoff_config.get("expected_output") or f"Return an ack and readiness evidence for {next_stage}").strip()
    configured_dedupe = str(handoff_config.get("dedupe_key") or "").strip()
    server_dedupe = (
        f"release-stage:{release_state.process_id}:{release_state.release_id}:"
        f"{release_state.current_stage}:{next_stage}:{shared_state.revision_id}"
    )
    dedupe_key = (
        f"{server_dedupe}:namespace:{hashlib.sha256(configured_dedupe.encode('utf-8')).hexdigest()[:16]}"
        if configured_dedupe
        else server_dedupe
    )
    lease_seconds = max(1, int(handoff_config.get("lease_seconds", 300) or 300))

    actions_taken: List[JsonDict] = []
    lease_metadata = {
        "release_id": release_state.release_id,
        "transition": f"{release_state.current_stage}->{next_stage}",
        "contract": "release_handoff",
    }
    existing_leases = [
        row
        for row in supervisor.list(process_id=release_state.process_id)
        if row.scope == scope and row.agent_id == to_agent and row.status == "active"
    ]
    if existing_leases:
        lease = existing_leases[0]
        supervisor.heartbeat(lease.lease_id, lease_seconds=lease_seconds)
        actions_taken.append({"action": "heartbeat_release_scope", "lease_id": lease.lease_id, "scope": scope, "agent_id": to_agent})
    else:
        lease = supervisor.assign(
            process_id=release_state.process_id,
            scope=scope,
            agent_id=to_agent,
            lease_seconds=lease_seconds,
            metadata=lease_metadata,
        )
        actions_taken.append({"action": "assign_release_scope", "lease_id": lease.lease_id, "scope": scope, "agent_id": to_agent})

    handoff = compile_release_handoff(
        state=release_state,
        shared_state=shared_state,
        snapshot=snapshot,
        from_agent=from_agent,
        to_agent=to_agent,
        objective=objective,
        scope=scope,
        expected_output=expected_output,
        gate={"safe_push": False, "blockers": [{"summary": f"waiting for {next_stage} promotion handoff"}]},
        open_questions=[str(row) for row in (handoff_config.get("open_questions") or []) if str(row).strip()],
        relevant_artifact_ids=[str(row) for row in (handoff_config.get("relevant_artifact_ids") or []) if str(row).strip()],
        relevant_evidence_ids=[str(row) for row in (handoff_config.get("relevant_evidence_ids") or []) if str(row).strip()],
        timeout_seconds=int(handoff_config.get("timeout_seconds", 900) or 900),
        lease_seconds=lease_seconds,
    )
    message = mailbox.send(
        process_id=release_state.process_id,
        from_agent=handoff.from_agent,
        to_agent=handoff.to_agent,
        kind="handoff",
        handoff_id=handoff.handoff_id,
        revision_id=shared_state.revision_id,
        dedupe_key=dedupe_key,
        payload={
            "objective": handoff.objective,
            "scope": handoff.scope,
            "expected_output": handoff.expected_output,
            "open_questions": list(handoff.open_questions or []),
            "assumptions": list(handoff.assumptions or []),
            "relevant_artifacts": [
                row.model_dump() if hasattr(row, "model_dump") else row.dict()
                for row in handoff.relevant_artifacts
            ],
            "relevant_evidence": [
                row.model_dump() if hasattr(row, "model_dump") else row.dict()
                for row in handoff.relevant_evidence
            ],
            "artifact_receipts": [
                dict(row)
                for row in (release_state.metadata.get("release_artifacts") or [])
                if isinstance(row, dict)
                and str(row.get("release_id") or "") == release_state.release_id
                and str(row.get("revision_id") or "") == release_state.revision_id
            ],
            "lease_id": lease.lease_id,
            "lease_generation": lease.generation,
        },
        metadata={
            "release_id": release_state.release_id,
            "candidate_ref": release_state.candidate_ref,
            "transition": f"{release_state.current_stage}->{next_stage}",
            "target_stage": next_stage,
            "lease_id": lease.lease_id,
            "lease_generation": lease.generation,
            "lease_scope": lease.scope,
        },
    )
    release_state = record_release_handoff(release_state, message, stage=next_stage, notes="auto-dispatched by production build loop")
    actions_taken.append({"action": "dispatch_release_handoff", "message_id": message.message_id, "target_stage": next_stage, "to_agent": to_agent})

    return {"state": release_state, "actions_taken": actions_taken}



def advance_production_release_loop(
    contract: ProductionBuildContract,
    *,
    loop_state: ProductionBuildLoopState,
    snapshot: ProcessSnapshot,
    shared_state: SharedProcessState,
    dependability_report: JsonDict,
    mailbox: AgentMailbox,
    supervisor: AgentSupervisor,
    release_store: ReleaseWorkflowStore,
    snapshot_store: ProcessSnapshotStore,
    shared_state_store: SharedProcessStateStore,
    controller_id: str,
    budget: Optional[ProductionPassBudget] = None,
) -> JsonDict:
    release_state = release_store.load(contract.process_id)
    if release_state is None:
        return {"state": None, "actions_taken": [], "last_gate": None, "stage_changes": []}

    actions_taken: List[JsonDict] = []
    stage_changes: List[JsonDict] = []
    last_gate: Optional[JsonDict] = None
    stage_advances = 0
    stage_advance_limit = max(1, int((budget.max_stage_advances_per_pass if budget is not None else 1) or 1))
    artifact_store = release_store.artifact_store()
    verifier_credentials: Optional[Dict[str, str]] = None
    if _production_environment():
        active_verifier_credentials = _runtime_delivery_credential_map(
            "CORTEX_RELEASE_VERIFIER_CREDENTIALS"
        )
        if not active_verifier_credentials:
            raise RuntimeError("production requires release verifier credentials")
        verifier_credentials, _ = _durable_release_verifier_credentials(
            release_store.path.parent,
            active_verifier_credentials,
        )

    for _ in range(len(_stage_plan(contract)) + 1):
        captured_current_fencepost = False
        next_stage = _next_stage(contract, release_state.current_stage)
        if not next_stage:
            break
        if stage_advances >= stage_advance_limit:
            break
        if (
            release_state.current_stage != "draft"
            and not any(row.stage == release_state.current_stage for row in release_state.rollback_fenceposts)
        ):
            prior_fencepost = capture_release_rollback_fencepost(
                snapshot=snapshot,
                shared_state=shared_state,
                stage=release_state.current_stage,
                metadata={"captured_by": "production_build_loop", "pre_promotion": True},
            )
            release_state = release_store.save(
                record_release_fencepost(release_state, prior_fencepost),
                actor=controller_id,
                provenance={
                    "scenario": "production_build_loop",
                    "action": "capture_pre_promotion_fencepost",
                    "stage": release_state.current_stage,
                    "iteration": loop_state.iteration_count + 1,
                },
            )
            actions_taken.append(
                {
                    "action": "capture_release_fencepost",
                    "stage": release_state.current_stage,
                    "fencepost_id": prior_fencepost.fencepost_id,
                    "timing": "pre_promotion",
                }
            )
            captured_current_fencepost = True
        gate_spec = _stage_gate_for(contract, next_stage)
        handoff_dispatch = _maybe_dispatch_release_handoff(
            release_state,
            next_stage=next_stage,
            gate_spec=gate_spec,
            snapshot=snapshot,
            shared_state=shared_state,
            mailbox=mailbox,
            supervisor=supervisor,
            controller_id=controller_id,
        )
        release_state = handoff_dispatch.get("state") or release_state
        actions_taken.extend(list(handoff_dispatch.get("actions_taken") or []))
        handoff_config = dict(gate_spec.metadata.get("handoff") or {}) if isinstance(gate_spec.metadata.get("handoff"), dict) else {}
        allowed_active_agents = _dedupe_rows(
            list(gate_spec.allowed_active_agents)
            + [controller_id]
            + [str(handoff_config.get("from_agent") or "").strip(), str(handoff_config.get("to_agent") or "").strip()]
            + list(snapshot.assigned_agents.values())
            + list(shared_state.agent_ownership.values())
        )
        observed_mailbox = mailbox.list(process_id=contract.process_id)
        _, observed_leases = supervisor.list_with_revision()
        observed_mailbox_digest = _persistence_rows_digest(observed_mailbox)
        gate = evaluate_release_promotion_gate(
            state=release_state,
            snapshot=snapshot,
            shared_state=shared_state,
            target_stage=next_stage,
            mailbox_messages=observed_mailbox,
            leases=observed_leases,
            dependability_report=dependability_report,
            required_fencepost_stages=list(gate_spec.required_fencepost_stages),
            required_artifacts=list(gate_spec.required_artifacts),
            required_handoff_count=int(gate_spec.required_handoff_count or 0),
            allowed_active_agents=allowed_active_agents,
            allowed_lifecycle_states=list(gate_spec.allowed_lifecycle_states),
            require_dependability=bool(gate_spec.require_dependability),
            artifact_store=artifact_store,
            verifier_credentials=verifier_credentials,
        )
        last_gate = gate
        if not gate.get("safe_push"):
            repaired = repair_release_workflow(
                release_state,
                snapshot=snapshot,
                shared_state=shared_state,
                mailbox=mailbox,
                supervisor=supervisor,
                gate=gate,
                target_stage=next_stage,
                dependability_report=dependability_report,
                required_fencepost_stages=list(gate_spec.required_fencepost_stages),
                required_artifacts=list(gate_spec.required_artifacts),
                required_handoff_count=int(gate_spec.required_handoff_count or 0),
                allowed_active_agents=allowed_active_agents,
                allowed_lifecycle_states=list(gate_spec.allowed_lifecycle_states),
                require_dependability=bool(gate_spec.require_dependability),
                artifact_store=artifact_store,
                verifier_credentials=verifier_credentials,
            )
            release_state = release_store.save(
                repaired["state"],
                actor=controller_id,
                provenance={"scenario": "production_build_loop", "action": "repair_release_workflow", "iteration": loop_state.iteration_count + 1},
            )
            last_gate = repaired.get("gate_after") or gate
            actions_taken.append(
                {
                    "action": "repair_release_workflow",
                    "target_stage": next_stage,
                    "success": bool(repaired.get("success")),
                    "repair_actions": list(repaired.get("actions_taken") or []),
                }
            )
            if not bool((last_gate or {}).get("safe_push")):
                break
            # The repair path can mutate leases and mailbox state. Re-evaluate
            # against a fresh, revision-bound view before promotion.
            observed_mailbox = mailbox.list(process_id=contract.process_id)
            _, observed_leases = supervisor.list_with_revision()
            observed_mailbox_digest = _persistence_rows_digest(observed_mailbox)
            last_gate = evaluate_release_promotion_gate(
                state=release_state,
                snapshot=snapshot,
                shared_state=shared_state,
                target_stage=next_stage,
                mailbox_messages=observed_mailbox,
                leases=observed_leases,
                dependability_report=dependability_report,
                required_fencepost_stages=list(gate_spec.required_fencepost_stages),
                required_artifacts=list(gate_spec.required_artifacts),
                required_handoff_count=int(gate_spec.required_handoff_count or 0),
                allowed_active_agents=allowed_active_agents,
                allowed_lifecycle_states=list(gate_spec.allowed_lifecycle_states),
                require_dependability=bool(gate_spec.require_dependability),
                artifact_store=artifact_store,
                verifier_credentials=verifier_credentials,
            )
            if not bool(last_gate.get("safe_push")):
                break

        if release_state.current_stage != "draft" and not captured_current_fencepost:
            pre_promotion_fencepost = capture_release_rollback_fencepost(
                snapshot=snapshot,
                shared_state=shared_state,
                stage=release_state.current_stage,
                metadata={"captured_by": "production_build_loop", "pre_promotion": True},
            )
            release_state = release_store.save(
                record_release_fencepost(release_state, pre_promotion_fencepost),
                actor=controller_id,
                provenance={
                    "scenario": "production_build_loop",
                    "action": "refresh_pre_promotion_fencepost",
                    "stage": release_state.current_stage,
                    "iteration": loop_state.iteration_count + 1,
                },
            )
            actions_taken.append(
                {
                    "action": "capture_release_fencepost",
                    "stage": release_state.current_stage,
                    "fencepost_id": pre_promotion_fencepost.fencepost_id,
                    "timing": "pre_promotion",
                }
            )

        release_store.assert_mutation_allowed(contract.process_id, operation="release promotion")
        approved_handoffs = [
            row
            for row in release_state.handoff_records
            if str(row.get("stage") or "").strip() == next_stage
            and str(row.get("delivery_status") or "").strip() == "acked"
        ]
        handoff_scope = str(handoff_config.get("scope") or f"release:{next_stage}").strip()
        for handoff_row in approved_handoffs:
            lease_id = str(handoff_row.get("lease_id") or "").strip()
            generation = handoff_row.get("lease_generation")
            if not lease_id or generation is None or str(handoff_row.get("lease_scope") or "").strip() != handoff_scope:
                continue
            try:
                lease = supervisor.complete_active_generation(
                    lease_id,
                    generation=int(generation),
                    metadata={"resolution": "release_approval_recorded", "stage": next_stage},
                )
            except (KeyError, RuntimeError, ValueError) as exc:
                actions_taken.append(
                    {"action": "reject_stale_approval_generation", "lease_id": lease_id, "stage": next_stage, "reason": str(exc)}
                )
                continue
            actions_taken.append(
                {"action": "release_approval_scope", "lease_id": lease.lease_id, "stage": next_stage}
            )
        with supervisor.promotion_snapshot(
            process_id=contract.process_id,
            minimum_remaining_seconds=_promotion_lease_margin_seconds(),
        ) as (_, commit_leases):
            authoritative_release = release_store.load(contract.process_id)
            authoritative_snapshot = snapshot_store.load(contract.process_id)
            authoritative_shared = shared_state_store.load(contract.process_id)
            current_mailbox = mailbox.list(process_id=contract.process_id)
            current_mailbox_digest = _persistence_rows_digest(current_mailbox)
            stale_gate_inputs = bool(
                authoritative_release is None
                or authoritative_release.persistence_revision != release_state.persistence_revision
                or authoritative_snapshot is None
                or authoritative_snapshot.persistence_revision != snapshot.persistence_revision
                or authoritative_shared is None
                or authoritative_shared.revision_id != shared_state.revision_id
                or current_mailbox_digest != observed_mailbox_digest
            )
            if stale_gate_inputs:
                actions_taken.append({"action": "abort_stale_promotion_inputs", "target_stage": next_stage})
                break
            controller_scope = f"{contract.controller_scope}:{contract.process_id}"
            gate_commit_leases = [row for row in commit_leases if row.scope != controller_scope]
            if any(row.status == "active" for row in gate_commit_leases):
                actions_taken.append({"action": "abort_active_commit_leases", "target_stage": next_stage})
                break
            last_gate = evaluate_release_promotion_gate(
                state=authoritative_release,
                snapshot=authoritative_snapshot,
                shared_state=authoritative_shared,
                target_stage=next_stage,
                mailbox_messages=current_mailbox,
                leases=gate_commit_leases,
                dependability_report=dependability_report,
                required_fencepost_stages=list(gate_spec.required_fencepost_stages),
                required_artifacts=list(gate_spec.required_artifacts),
                required_handoff_count=int(gate_spec.required_handoff_count or 0),
                allowed_active_agents=allowed_active_agents,
                allowed_lifecycle_states=list(gate_spec.allowed_lifecycle_states),
                require_dependability=bool(gate_spec.require_dependability),
                artifact_store=artifact_store,
                verifier_credentials=verifier_credentials,
            )
            if not bool(last_gate.get("safe_push")):
                actions_taken.append({"action": "abort_unhealthy_commit_leases", "target_stage": next_stage})
                break
            promoted = advance_release_workflow(
                authoritative_release,
                gate=last_gate,
                next_stage=next_stage,
                actor=controller_id,
                metadata={
                    "dependability_policy_id": str(dependability_report.get("policy_id") or ""),
                    "dependability_policy_digest": str(dependability_report.get("policy_digest") or ""),
                    "dependability_campaign_id": str(((dependability_report.get("campaign") or {}).get("campaign_id")) or ""),
                },
            )
            if not promoted.get("promoted"):
                break
            # The supervisor read lock remains held through this durable save;
            # no heartbeat, reclaim, release, or assignment can invalidate the
            # commit-time lease evidence until promotion is committed.
            release_state = release_store.save(
                promoted["state"],
                actor=controller_id,
                provenance={"scenario": "production_build_loop", "action": "advance_release_stage", "iteration": loop_state.iteration_count + 1},
            )
        release_fencepost = capture_release_rollback_fencepost(
            snapshot=snapshot,
            shared_state=shared_state,
            stage=next_stage,
            metadata={"captured_by": "production_build_loop", "post_promotion": True},
        )
        release_state = release_store.save(
            record_release_fencepost(release_state, release_fencepost),
            actor=controller_id,
            provenance={"scenario": "production_build_loop", "action": "capture_release_fencepost", "stage": next_stage, "iteration": loop_state.iteration_count + 1},
        )
        stage_advances += 1
        stage_changes.append({"from_stage": promoted.get("previous_stage"), "to_stage": next_stage})
        actions_taken.append({"action": "advance_release_stage", "from_stage": promoted.get("previous_stage"), "to_stage": next_stage})
        actions_taken.append({"action": "capture_release_fencepost", "stage": next_stage, "fencepost_id": release_fencepost.fencepost_id})
        if next_stage == contract.target_environment:
            break

    return {
        "state": release_state,
        "actions_taken": actions_taken,
        "last_gate": last_gate,
        "stage_changes": stage_changes,
        "stage_advances": stage_advances,
        "stage_budget_exhausted": stage_advances >= stage_advance_limit and bool(_next_stage(contract, release_state.current_stage)),
        "next_stage": _next_stage(contract, release_state.current_stage),
    }



def _reconcile_production_build_loop_pass(
    contract: ProductionBuildContract,
    *,
    loop_store: ProductionBuildLoopStore,
    snapshot_store: ProcessSnapshotStore,
    shared_state_store: SharedProcessStateStore,
    journal: ProcessJournal,
    mailbox: AgentMailbox,
    supervisor: AgentSupervisor,
    release_store: ReleaseWorkflowStore,
    controller_id: str,
    controller_session_id: str,
    now: Optional[datetime] = None,
    pass_index: int = 1,
    watchdog_context: Optional[Dict[str, Any]] = None,
) -> JsonDict:
    previous_state = loop_store.load_state(contract.process_id)
    state = previous_state or ProductionBuildLoopState(contract_id=contract.contract_id, process_id=contract.process_id)
    budget = contract.execution_budget
    dependability_now = _dependability_server_now()

    ownership = _claim_controller(
        contract,
        previous_state=previous_state,
        supervisor=supervisor,
        controller_id=controller_id,
        controller_session_id=controller_session_id,
        now=now,
    )
    controller = ownership["owner"]
    ownership_actions = list(ownership.get("actions") or [])
    if not bool(ownership.get("owned_by_current_session")):
        raise PermissionError(
            f"production build loop controller is already owned for {contract.process_id}: "
            f"controller={controller.controller_id}, session={controller.session_id}"
        )
    loop_store.save_contract(contract)

    snapshot = snapshot_store.load(contract.process_id)
    shared_state = shared_state_store.load(contract.process_id)
    if snapshot is None or shared_state is None:
        raise ValueError("snapshot and shared state are required for production build loop")
    release_state = release_store.load(contract.process_id)
    dependability_binding = _production_dependability_binding(
        contract,
        shared_state=shared_state,
        release_state=release_state,
    )
    campaign_evidence = (
        dict((state.metadata or {}).get("dependability_campaign") or {})
        if isinstance((state.metadata or {}).get("dependability_campaign"), dict)
        else {}
    )

    dependability = repair_production_dependability(
        contract,
        snapshot_store=snapshot_store,
        shared_state_store=shared_state_store,
        journal=journal,
        mailbox=mailbox,
        supervisor=supervisor,
        controller_id=controller_id,
        campaign_evidence=campaign_evidence,
        evidence_binding=dependability_binding,
        now=dependability_now,
    )
    snapshot = snapshot_store.load(contract.process_id) or snapshot
    shared_state = shared_state_store.load(contract.process_id) or shared_state
    release_state = release_store.load(contract.process_id)
    dependability_binding = _production_dependability_binding(
        contract,
        shared_state=shared_state,
        release_state=release_state,
    )
    preliminary_dependability = load_dependability_report(
        process_id=contract.process_id,
        snapshot_store=snapshot_store,
        shared_state_store=shared_state_store,
        journal=journal,
        mailbox=mailbox,
        supervisor=supervisor,
        profile=contract.dependability_profile,
        campaign_evidence=campaign_evidence,
        evidence_binding=dependability_binding,
        now=dependability_now,
    )
    campaign_evidence, campaign_actions = _advance_production_dependability_campaign(
        contract,
        existing=campaign_evidence,
        binding=dependability_binding,
        preliminary_report=preliminary_dependability,
        snapshot=snapshot,
        now=dependability_now,
    )
    state = loop_store.save_state(
        ProductionBuildLoopState(
            **{
                **_state_dump(state),
                "controller": controller,
                "current_revision_id": shared_state.revision_id,
                "current_snapshot_id": snapshot.snapshot_id,
                "current_stage": release_state.current_stage if release_state else state.current_stage,
                "metadata": {
                    **dict(state.metadata or {}),
                    "dependability_policy_id": contract.dependability_profile,
                    "dependability_policy_digest": unattended_profile_digest(contract.dependability_profile),
                    "dependability_campaign": campaign_evidence,
                },
            }
        )
    )
    dependability_after_now = _dependability_server_now()
    dependable_after = load_dependability_report(
        process_id=contract.process_id,
        snapshot_store=snapshot_store,
        shared_state_store=shared_state_store,
        journal=journal,
        mailbox=mailbox,
        supervisor=supervisor,
        profile=contract.dependability_profile,
        campaign_evidence=campaign_evidence,
        evidence_binding=dependability_binding,
        now=dependability_after_now,
    )
    dependability["after"] = dependable_after
    dependability["success"] = bool(dependable_after.get("success"))
    dependability.setdefault("actions_taken", []).extend(campaign_actions)

    blockers_before_recovery = detect_true_blockers(
        contract,
        snapshot=snapshot,
        shared_state=shared_state,
        release_state=release_state,
    )

    worker_recovery = {"recovered": False, "actions_taken": []}
    # A release workflow must remain quiescent while an independent recipient
    # evaluates promotion evidence. Resuming a worker changes the lifecycle to
    # running and would invalidate the mandatory release gate.
    if not blockers_before_recovery and snapshot.lifecycle_state != "completed" and release_state is None:
        worker_recovery = recover_production_worker(
            contract,
            snapshot_store=snapshot_store,
            shared_state_store=shared_state_store,
            journal=journal,
            mailbox=mailbox,
            supervisor=supervisor,
            controller_id=controller_id,
        )
        snapshot = snapshot_store.load(contract.process_id) or snapshot
        shared_state = shared_state_store.load(contract.process_id) or shared_state

    release_progress = advance_production_release_loop(
        contract,
        loop_state=state,
        snapshot=snapshot,
        shared_state=shared_state,
        dependability_report=dependability.get("after") or dependability.get("before") or {},
        mailbox=mailbox,
        supervisor=supervisor,
        release_store=release_store,
        snapshot_store=snapshot_store,
        shared_state_store=shared_state_store,
        controller_id=controller_id,
        budget=budget,
    )
    release_state = release_progress.get("state") or release_state
    stage_changes = list(release_progress.get("stage_changes") or [])

    blockers = detect_true_blockers(
        contract,
        snapshot=snapshot,
        shared_state=shared_state,
        release_state=release_state,
    )
    projected_state = ProductionBuildLoopState(**{**_state_dump(state), "current_stage": release_state.current_stage if release_state else state.current_stage})
    validation_decision = _production_validation_decision(
        contract,
        budget=budget,
        previous_state=previous_state,
        state=projected_state,
        stage_changes=stage_changes,
    )
    validation_scope = str(validation_decision.get("scope") or "focused")
    if validation_scope == "broad":
        completion = evaluate_production_completion(
            contract,
            snapshot=snapshot,
            shared_state=shared_state,
            dependability_report=dependability.get("after") or dependability.get("before"),
            release_state=release_state,
        )
    else:
        completion = dict(previous_state.completion or {}) if previous_state is not None else {"all_required_satisfied": False, "criteria": []}
        completion.update(
            {
                "all_required_satisfied": False,
                "validation_scope": validation_scope,
                "validation_reasons": list(validation_decision.get("reasons") or []),
                "criteria": list(completion.get("criteria") or []),
            }
        )
    completion["validation_scope"] = validation_scope
    completion["validation_reasons"] = list(validation_decision.get("reasons") or [])

    human_blockers = _has_human_blockers(blockers)
    completed = bool(completion.get("all_required_satisfied")) and not blockers
    status = "completed" if completed else ("blocked" if human_blockers else "active")
    next_iteration = int(state.iteration_count or 0) + 1
    all_actions = ownership_actions + list(dependability.get("actions_taken") or []) + list(worker_recovery.get("actions_taken") or []) + list(release_progress.get("actions_taken") or [])
    previous_blocker_keys = {_report_blocker_key(row) for row in (state.true_blockers or [])}
    current_blocker_keys = {_report_blocker_key(row) for row in blockers}
    budget_exhausted = bool(release_progress.get("stage_budget_exhausted"))

    next_action = _production_next_action(
        contract,
        state=projected_state,
        blockers=blockers,
        completion=completion,
        budget=budget,
        pass_index=pass_index,
        next_stage=release_progress.get("next_stage"),
        snapshot=snapshot,
        budget_exhausted=budget_exhausted,
        release_gate=release_progress.get("last_gate"),
    )
    continuation = _production_continuation(status=status, blockers=blockers, next_action=next_action)
    pass_objective = str(next_action.get("summary") or next_action.get("kind") or contract.objective)
    pass_budget = budget.model_dump() if hasattr(budget, "model_dump") else budget.dict()

    report_reasons: List[str] = []
    now_iso = _now_iso(now)
    if previous_state is None:
        report_reasons.append("initial")
    if next_iteration % int(contract.checkpoint_policy.report_every_iterations or 1) == 0:
        report_reasons.append("iteration_interval")
    if status != state.status:
        report_reasons.append("status_change")
    if contract.checkpoint_policy.report_on_stage_change and stage_changes:
        report_reasons.append("stage_change")
    if contract.checkpoint_policy.report_on_recovery and (ownership.get("recovery") or worker_recovery.get("recovered")):
        report_reasons.append("recovery")
    if contract.checkpoint_policy.report_on_blocker_change and previous_blocker_keys != current_blocker_keys:
        report_reasons.append("blocker_change")
    if completed:
        report_reasons.append("completed")
    if human_blockers:
        report_reasons.append("human_blocker")
    elif blockers:
        report_reasons.append("non_human_blocker")
    if status == "blocked":
        report_reasons.append("blocked")
    if watchdog_context and str(watchdog_context.get("decision") or "") == "auto_resume":
        report_reasons.append("idle_recovery")

    review_plan = _production_review_plan(
        policy=contract.checkpoint_policy,
        previous_state=previous_state,
        status=status,
        blockers=blockers,
        next_action=next_action,
        continuation=continuation,
        now=now,
        report_reasons=report_reasons,
        watchdog_context=watchdog_context,
    )
    if review_plan.get("report_due"):
        report_reasons.append("review_due")
    if watchdog_context and str(watchdog_context.get("decision") or "") == "report_blocker":
        report_reasons.append("blocker_followup_due")
    if watchdog_context and str(watchdog_context.get("decision") or "") == "report_status":
        report_reasons.append("status_followup_due")
    report_reasons = _dedupe_rows(report_reasons)
    last_progress_at, last_progress = _production_progress_record(
        contract=contract,
        previous_state=previous_state,
        status=status,
        stage=release_state.current_stage if release_state else None,
        actions_taken=all_actions,
        report_reasons=report_reasons,
        next_action=next_action,
        now_iso=now_iso,
    )

    execution_discipline = {
        "reporting_policy": _policy_dump(contract.checkpoint_policy),
        "blocker_policy": {
            "mode": "human_needed_only",
            "builtin_question_prefixes": list(BUILTIN_BLOCKER_PREFIXES),
            "human_needed_classes": sorted(HUMAN_BLOCKER_CLASSES),
            "true_blocker_count": len(blockers),
            "true_blocker_sources": _dedupe_rows([str(row.get("source") or "") for row in blockers]),
        },
        "validation_policy": {
            **validation_decision,
            "configured": _policy_dump(contract.execution_budget),
        },
        "continuation_policy": {
            "mode": continuation.get("mode"),
            "reason": continuation.get("reason"),
            "next_action_kind": next_action.get("kind"),
            "quality_gate": "promotion_or_completion_checkpoint" if validation_scope == "broad" else "bounded_pass_focused_validation",
        },
        "reporting_cadence": dict(review_plan.get("reporting_cadence") or {}),
        "owed_follow_up": dict(review_plan.get("owed_follow_up") or {}),
        "watchdog": dict(watchdog_context or {}),
        "latest_decisions": {
            "status": status,
            "summary_hint": str(next_action.get("summary") or pass_objective),
            "report_reasons": _dedupe_rows(report_reasons),
            "pass_index": pass_index,
            "pass_objective": pass_objective,
            "budget_exhausted": budget_exhausted,
            "current_stage": release_state.current_stage if release_state else None,
            "stage_changes": list(stage_changes),
        },
    }

    report_kind = "completed" if completed else ("blocked" if status == "blocked" else ("recovery" if any(reason in report_reasons for reason in {"recovery", "idle_recovery"}) else "checkpoint"))
    summary = (
        f"production build loop completed for {contract.process_id}: stage={release_state.current_stage if release_state else 'n/a'}, validation={validation_scope}"
        if completed
        else f"production build loop blocked for {contract.process_id}: {len(blockers)} true blockers, next={next_action.get('kind') or 'needs_human_decision'}"
        if status == "blocked"
        else f"production build loop active for {contract.process_id}: stage={release_state.current_stage if release_state else 'n/a'}, next={next_action.get('kind') or 'n/a'}, validation={validation_scope}"
    )

    report_record: Optional[ProductionBuildLoopReport] = None
    if report_reasons:
        report_record = loop_store.append_report(
            ProductionBuildLoopReport(
                loop_id=state.loop_id,
                contract_id=contract.contract_id,
                process_id=contract.process_id,
                iteration=next_iteration,
                kind=report_kind,
                status=status,
                summary=summary,
                controller_id=controller.controller_id,
                controller_session_id=controller.session_id,
                stage=release_state.current_stage if release_state else None,
                actions_taken=all_actions,
                blockers=blockers,
                completion=completion,
                metadata={
                    "reasons": _dedupe_rows(report_reasons),
                    "dependability_success": bool((dependability.get("after") or dependability.get("before") or {}).get("success")),
                    "release_safe_push": bool((release_progress.get("last_gate") or {}).get("safe_push")) if release_progress.get("last_gate") is not None else None,
                    "pass_index": pass_index,
                    "pass_objective": pass_objective,
                    "pass_budget": pass_budget,
                    "validation_scope": validation_scope,
                    "validation_reasons": list(validation_decision.get("reasons") or []),
                    "continuation": dict(continuation),
                    "next_action": dict(next_action),
                    "last_progress": dict(last_progress),
                    "reporting_cadence": dict(review_plan.get("reporting_cadence") or {}),
                    "owed_follow_up": dict(review_plan.get("owed_follow_up") or {}),
                    "conversation_ownership": _production_conversation_ownership(
                        contract=contract,
                        previous_state=previous_state,
                        review_plan=review_plan,
                        report_record=None,
                        now_iso=now_iso,
                    ),
                    "follow_through": {
                        "continuation": dict(continuation),
                        "next_action": dict(next_action),
                        "next_required_update_at": (review_plan.get("owed_follow_up") or {}).get("due_at"),
                        "next_required_review_at": review_plan.get("next_review_at"),
                        "report_due": bool(review_plan.get("report_due")),
                        "review_due": bool(review_plan.get("review_due")),
                    },
                    "watchdog": dict(watchdog_context or {}),
                    "execution_discipline": execution_discipline,
                },
            )
        )

    last_report = (
        {
            "report_id": report_record.report_id,
            "recorded_at": report_record.recorded_at,
            "kind": report_record.kind,
            "status": report_record.status,
            "summary": report_record.summary,
            "reasons": list((report_record.metadata or {}).get("reasons") or []),
        }
        if report_record is not None
        else dict(previous_state.last_report or {}) if previous_state is not None else {}
    )
    conversation_ownership = _production_conversation_ownership(
        contract=contract,
        previous_state=previous_state,
        review_plan=review_plan,
        report_record=report_record,
        now_iso=now_iso,
    )
    follow_through = _production_follow_through(
        previous_state=previous_state,
        status=status,
        next_action=next_action,
        continuation=continuation,
        review_plan=review_plan,
        report_reasons=report_reasons,
        report_record=report_record,
        watchdog_context=watchdog_context,
        now_iso=now_iso,
    )
    updated_state = ProductionBuildLoopState(
        loop_id=state.loop_id,
        contract_id=contract.contract_id,
        process_id=contract.process_id,
        persistence_revision=state.persistence_revision,
        status=status,
        liveness=str(review_plan.get("liveness") or ("terminal" if status == "completed" else "live")),
        terminal_state=review_plan.get("terminal_state"),
        iteration_count=next_iteration,
        checkpoint_count=int(state.checkpoint_count or 0) + (1 if report_record is not None else 0),
        recovery_count=int(state.recovery_count or 0) + (1 if ownership.get("recovery") else 0),
        controller=controller,
        current_revision_id=shared_state.revision_id,
        current_snapshot_id=snapshot.snapshot_id,
        current_stage=release_state.current_stage if release_state else None,
        latest_report_id=report_record.report_id if report_record else state.latest_report_id,
        last_checkpoint_at=report_record.recorded_at if report_record else state.last_checkpoint_at,
        last_progress_at=last_progress_at,
        last_report_at=report_record.recorded_at if report_record else (previous_state.last_report_at if previous_state is not None else None),
        next_review_at=review_plan.get("next_review_at"),
        last_watchdog_at=now_iso if watchdog_context else (previous_state.last_watchdog_at if previous_state is not None else None),
        true_blockers=blockers,
        completion=completion,
        next_action=next_action,
        continuation=continuation,
        last_pass={
            "index": pass_index,
            "objective": pass_objective,
            "budget": pass_budget,
            "validation_scope": validation_scope,
            "validation_reasons": list(validation_decision.get("reasons") or []),
            "budget_exhausted": budget_exhausted,
            "stage_advances": _int_budget(release_progress.get("stage_advances")),
        },
        last_progress=last_progress,
        last_report=last_report,
        owed_follow_up=dict(review_plan.get("owed_follow_up") or {}),
        reporting_cadence=dict(review_plan.get("reporting_cadence") or {}),
        conversation_ownership=conversation_ownership,
        follow_through=follow_through,
        last_watchdog_decision={
            **(dict(previous_state.last_watchdog_decision or {}) if previous_state is not None else {}),
            **dict(watchdog_context or {}),
            **({"recorded_at": now_iso, "review_due": bool(review_plan.get("review_due")), "next_review_at": review_plan.get("next_review_at")} if watchdog_context else {}),
        },
        metadata={
            **dict(state.metadata or {}),
            "objective": contract.objective,
            "last_dependability_success": bool((dependability.get("after") or dependability.get("before") or {}).get("success")),
            "last_report_reasons": _dedupe_rows(report_reasons),
            "last_actions": all_actions,
            "pass_budget": pass_budget,
            "pass_objective": pass_objective,
            "validation_scope": validation_scope,
            "continuation_mode": continuation.get("mode"),
            "execution_discipline": execution_discipline,
            "reporting_policy": _policy_dump(contract.checkpoint_policy),
            "validation_policy": validation_decision,
            "blocker_policy": execution_discipline["blocker_policy"],
            "liveness": str(review_plan.get("liveness") or ("terminal" if status == "completed" else "live")),
            "terminal_state": review_plan.get("terminal_state"),
            "next_review_at": review_plan.get("next_review_at"),
            "last_progress": last_progress,
            "last_report": last_report,
            "owed_follow_up": dict(review_plan.get("owed_follow_up") or {}),
            "reporting_cadence": dict(review_plan.get("reporting_cadence") or {}),
            "conversation_ownership": conversation_ownership,
            "follow_through": follow_through,
            "watchdog": dict(watchdog_context or {}),
        },
    )
    updated_state = loop_store.save_state(updated_state)

    if status in {"blocked", "completed"}:
        supervisor.resolve(controller.lease_id, status="released", metadata={"resolution": status})

    return {
        "contract": _contract_dump(contract),
        "state": _state_dump(updated_state),
        "report": _report_dump(report_record) if report_record is not None else None,
        "dependability": dependability,
        "release": {
            "state": release_state.model_dump() if release_state and hasattr(release_state, "model_dump") else release_state.dict() if release_state else None,
            "last_gate": release_progress.get("last_gate"),
            "stage_changes": stage_changes,
        },
        "actions_taken": all_actions,
        "blockers": blockers,
        "completion": completion,
        "operator_summary": summary,
        "next_action": next_action,
        "continuation": continuation,
    }


def _reconcile_production_build_loop_transaction(
    contract: ProductionBuildContract,
    *,
    loop_store: ProductionBuildLoopStore,
    snapshot_store: ProcessSnapshotStore,
    shared_state_store: SharedProcessStateStore,
    journal: ProcessJournal,
    mailbox: AgentMailbox,
    supervisor: AgentSupervisor,
    release_store: ReleaseWorkflowStore,
    controller_id: str,
    controller_session_id: str,
    now: Optional[datetime] = None,
    watchdog_context: Optional[Dict[str, Any]] = None,
) -> JsonDict:
    final_result: Optional[JsonDict] = None
    chained_passes = 0
    now_iso = _now_iso(now)
    max_passes = max(1, int(contract.execution_budget.max_auto_chain_passes or 1))

    for pass_index in range(1, max_passes + 1):
        chained_passes = pass_index
        final_result = _reconcile_production_build_loop_pass(
            contract,
            loop_store=loop_store,
            snapshot_store=snapshot_store,
            shared_state_store=shared_state_store,
            journal=journal,
            mailbox=mailbox,
            supervisor=supervisor,
            release_store=release_store,
            controller_id=controller_id,
            controller_session_id=controller_session_id,
            now=now,
            pass_index=pass_index,
            watchdog_context=watchdog_context,
        )
        continuation = dict(final_result.get("continuation") or {})
        if continuation.get("mode") != "continue_now":
            break

    if final_result is None:
        raise ValueError("production build loop reconciliation produced no result")

    if chained_passes >= max_passes and dict(final_result.get("continuation") or {}).get("mode") == "continue_now":
        persisted_state = loop_store.load_state(contract.process_id)
        if persisted_state is not None:
            continuation = dict(persisted_state.continuation or {})
            continuation["reason"] = "auto_chain_budget_exhausted"
            next_action = dict(persisted_state.next_action or {})
            next_action["budget_exhausted"] = True
            review_plan = _production_review_plan(
                policy=contract.checkpoint_policy,
                previous_state=persisted_state,
                status=persisted_state.status,
                blockers=list(persisted_state.true_blockers or []),
                next_action=next_action,
                continuation=continuation,
                now=now,
                report_reasons=["auto_chain_budget_exhausted"],
                watchdog_context=watchdog_context,
            )
            execution_discipline = dict((persisted_state.metadata or {}).get("execution_discipline") or {})
            continuation_policy = dict(execution_discipline.get("continuation_policy") or {})
            continuation_policy.update({"mode": continuation.get("mode"), "reason": continuation.get("reason"), "next_action_kind": next_action.get("kind")})
            latest_decisions = dict(execution_discipline.get("latest_decisions") or {})
            latest_decisions.update({"budget_exhausted": True, "chained_passes": chained_passes})
            execution_discipline["continuation_policy"] = continuation_policy
            execution_discipline["latest_decisions"] = latest_decisions
            execution_discipline["reporting_cadence"] = dict(review_plan.get("reporting_cadence") or {})
            execution_discipline["owed_follow_up"] = dict(review_plan.get("owed_follow_up") or {})
            execution_discipline["watchdog"] = dict(watchdog_context or {})
            conversation_ownership = _production_conversation_ownership(
                contract=contract,
                previous_state=persisted_state,
                review_plan=review_plan,
                report_record=None,
                now_iso=now_iso,
            )
            follow_through = _production_follow_through(
                previous_state=persisted_state,
                status=persisted_state.status,
                next_action=next_action,
                continuation=continuation,
                review_plan=review_plan,
                report_reasons=["auto_chain_budget_exhausted"],
                report_record=None,
                watchdog_context=watchdog_context,
                now_iso=now_iso,
            )
            persisted_state = ProductionBuildLoopState(
                **{
                    **_state_dump(persisted_state),
                    "continuation": continuation,
                    "next_action": next_action,
                    "next_review_at": review_plan.get("next_review_at"),
                    "last_watchdog_at": now_iso if watchdog_context else persisted_state.last_watchdog_at,
                    "owed_follow_up": dict(review_plan.get("owed_follow_up") or {}),
                    "reporting_cadence": dict(review_plan.get("reporting_cadence") or {}),
                    "conversation_ownership": conversation_ownership,
                    "follow_through": follow_through,
                    "last_watchdog_decision": {
                        **dict(persisted_state.last_watchdog_decision or {}),
                        **dict(watchdog_context or {}),
                        **({"recorded_at": now_iso, "review_due": bool(review_plan.get("review_due")), "next_review_at": review_plan.get("next_review_at")} if watchdog_context else {}),
                    },
                    "last_pass": {
                        **dict(persisted_state.last_pass or {}),
                        "auto_chain_budget_exhausted": True,
                        "chained_passes": chained_passes,
                    },
                    "metadata": {
                        **dict(persisted_state.metadata or {}),
                        "chained_passes": chained_passes,
                        "auto_chain_budget_exhausted": True,
                        "next_review_at": review_plan.get("next_review_at"),
                        "owed_follow_up": dict(review_plan.get("owed_follow_up") or {}),
                        "reporting_cadence": dict(review_plan.get("reporting_cadence") or {}),
                        "conversation_ownership": conversation_ownership,
                        "follow_through": follow_through,
                        "watchdog": dict(watchdog_context or {}),
                        "execution_discipline": execution_discipline,
                    },
                }
            )
            persisted_state = loop_store.save_state(persisted_state)
            final_result["state"] = _state_dump(persisted_state)
            final_result["continuation"] = continuation
            final_result["next_action"] = next_action

    final_result["chained_passes"] = chained_passes
    final_state = dict(final_result.get("state") or {})
    final_state.setdefault("metadata", {})["chained_passes"] = chained_passes
    final_result["state"] = final_state
    return final_result


def reconcile_production_build_loop(
    contract: ProductionBuildContract,
    *,
    loop_store: ProductionBuildLoopStore,
    snapshot_store: ProcessSnapshotStore,
    shared_state_store: SharedProcessStateStore,
    journal: ProcessJournal,
    mailbox: AgentMailbox,
    supervisor: AgentSupervisor,
    release_store: ReleaseWorkflowStore,
    controller_id: str,
    controller_session_id: str,
    now: Optional[datetime] = None,
    watchdog_context: Optional[Dict[str, Any]] = None,
) -> JsonDict:
    # Promotion, artifact ingestion, and rollback all use this same process
    # fence. It covers every chained pass and the final loop projection so a
    # rollback cannot be followed by a stale promotion or loop-state save.
    with release_store.release_transaction(contract.process_id):
        intent = release_store.load_rollback_intent(contract.process_id)
        if intent and intent.get("status") in {"in_progress", "recovery_required"}:
            raise RuntimeError(
                f"release rollback recovery required before reconciliation: {contract.process_id}"
            )
        return _reconcile_production_build_loop_transaction(
            contract,
            loop_store=loop_store,
            snapshot_store=snapshot_store,
            shared_state_store=shared_state_store,
            journal=journal,
            mailbox=mailbox,
            supervisor=supervisor,
            release_store=release_store,
            controller_id=controller_id,
            controller_session_id=controller_session_id,
            now=now,
            watchdog_context=watchdog_context,
        )


__all__ = [
    "BuildLoopControllerOwner",
    "ProductionBlockerRule",
    "ProductionBuildContract",
    "ProductionBuildLoopReport",
    "ProductionBuildLoopState",
    "ProductionBuildLoopStore",
    "ProductionCheckpointPolicy",
    "ProductionCompletionCriterion",
    "ProductionPassBudget",
    "ProductionStageGate",
    "REQUIRED_RELEASE_HANDOFF_RECIPIENTS",
    "RUNTIME_DELIVERY_MANAGER_CAPABILITY_PROCESS_ID",
    "RUNTIME_DELIVERY_MANAGER_CAPABILITY_REASON",
    "RUNTIME_DELIVERY_MOUNT_MARKER",
    "advance_production_release_loop",
    "detect_true_blockers",
    "evaluate_production_completion",
    "ingest_production_release_artifact",
    "probe_runtime_delivery_readiness",
    "reconcile_production_build_loop",
    "recover_production_worker",
    "repair_production_dependability",
    "runtime_delivery_handoff_claim_signature",
    "runtime_delivery_handoff_discovery_signature",
    "runtime_delivery_artifact_fetch_signature",
    "runtime_delivery_manager_rollback_signature",
    "runtime_delivery_recipient_credentials",
    "runtime_delivery_release_observation_signature",
    "runtime_delivery_verifier_capability_signature",
    "runtime_delivery_verifier_credentials",
    "validate_production_delivery_credentials",
    "ValidationError",
]
