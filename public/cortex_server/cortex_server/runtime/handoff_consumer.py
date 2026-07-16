"""Standalone authenticated release handoff consumer used by production Compose."""

from __future__ import annotations

import base64
import hashlib
import json
import os
from pathlib import Path
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from urllib.request import Request, urlopen
from uuid import uuid4

from cortex_server.runtime.agent_mailbox import AgentMessage, agent_acknowledgement_signature
from cortex_server.runtime.production_build_loop import (
    RUNTIME_DELIVERY_MANAGER_CAPABILITY_PROCESS_ID,
    RUNTIME_DELIVERY_MANAGER_CAPABILITY_REASON,
    runtime_delivery_artifact_fetch_signature,
    runtime_delivery_handoff_discovery_signature,
    runtime_delivery_manager_rollback_signature,
    runtime_delivery_verifier_capability_signature,
)
from cortex_server.runtime.release_workflow import (
    prepare_release_artifact,
    release_artifact_attestation_signature,
    release_canary_policy,
)


_POLL_STATUS_LOCK = threading.Lock()
_POLL_STATUS: Dict[str, Any] = {
    "last_success_epoch": None,
    "last_success_at": None,
    "last_error": "authenticated poll has not succeeded",
    "awaiting_evidence_count": 0,
    "capability_verified": False,
    "last_measurement_at": None,
}


class _EvidencePending(RuntimeError):
    """A claimed handoff is healthy but its stage evidence is not ready yet."""


class _ObservationStore:
    """Bounded crash-durable counters for real elapsed observation windows."""

    def __init__(self, root: Path):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        try:
            os.chmod(self.root, 0o700)
            parent_fd = os.open(self.root.parent, os.O_RDONLY)
            try:
                os.fsync(parent_fd)
            finally:
                os.close(parent_fd)
        except OSError:
            raise
        self.path = self.root / "observations.json"
        self._lock = threading.Lock()

    def _load(self) -> Dict[str, Any]:
        if not self.path.exists():
            if self.path.is_symlink() or _require_existing_observation_state():
                raise RuntimeError("release controller observation state is missing")
            return {"version": "cortex.release-controller-observations.v1", "windows": {}}
        if self.path.is_symlink() or not self.path.is_file():
            raise RuntimeError("release controller observation state must be a regular non-symlink file")
        payload = json.loads(self.path.read_text(encoding="utf-8"))
        if (
            not isinstance(payload, dict)
            or payload.get("version") != "cortex.release-controller-observations.v1"
            or not isinstance(payload.get("windows"), dict)
            or len(payload["windows"]) > 4096
        ):
            raise RuntimeError("release controller observation state is invalid")
        return payload

    def _save(self, payload: Dict[str, Any]) -> None:
        encoded = (json.dumps(payload, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")
        if len(encoded) > 4 * 1024 * 1024:
            raise RuntimeError("release controller observation state exceeds durable bound")
        temporary = self.path.with_name(f".{self.path.name}.{os.getpid()}.{uuid4().hex}.tmp")
        try:
            with temporary.open("xb") as handle:
                os.fchmod(handle.fileno(), 0o600)
                handle.write(encoded)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, self.path)
            directory_fd = os.open(self.root, os.O_RDONLY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
        finally:
            try:
                temporary.unlink()
            except FileNotFoundError:
                pass

    def record(self, key: str, *, success: bool, observed_at: float) -> Dict[str, Any]:
        with self._lock:
            payload = self._load()
            windows = payload["windows"]
            current = dict(windows.get(key) or {})
            first = float(current.get("first_epoch", observed_at))
            total = int(current.get("total", 0)) + 1
            succeeded = int(current.get("succeeded", 0)) + (1 if success else 0)
            current = {
                "first_epoch": min(first, observed_at),
                "last_epoch": max(float(current.get("last_epoch", observed_at)), observed_at),
                "total": total,
                "succeeded": succeeded,
            }
            windows[key] = current
            self._save(payload)
            return dict(current)

    def clear(self, key: str) -> None:
        with self._lock:
            payload = self._load()
            if payload["windows"].pop(key, None) is not None:
                self._save(payload)

    def retain(self, keys: set[str]) -> None:
        with self._lock:
            payload = self._load()
            windows = payload["windows"]
            removed = [key for key in windows if key not in keys]
            for key in removed:
                windows.pop(key, None)
            if removed:
                self._save(payload)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _post_json(base_url: str, path: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    headers = {"content-type": "application/json"}
    if path.startswith((
        "/orchestrator/runtime/delivery/artifacts/",
        "/conductor/runtime/delivery/artifacts/",
    )):
        token = os.getenv("CORTEX_RELEASE_ARTIFACT_WRITE_TOKEN", "").strip()
        header_name = os.getenv(
            "CORTEX_RELEASE_ARTIFACT_WRITE_TOKEN_HEADER",
            "x-cortex-release-artifact-token",
        ).strip().lower()
        if _production_environment() and (len(token.encode("utf-8")) < 32 or not header_name):
            raise RuntimeError(
                "production release verifier requires a dedicated artifact transport credential"
            )
        if token and header_name:
            headers[header_name] = token
    request = Request(
        f"{base_url.rstrip('/')}{path}",
        data=json.dumps(payload, sort_keys=True).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    with urlopen(request, timeout=15) as response:
        result = json.loads(response.read().decode("utf-8"))
    if not isinstance(result, dict):
        raise RuntimeError("handoff API returned a non-object response")
    return result


def _production_environment() -> bool:
    return os.getenv("CORTEX_ENV", os.getenv("CORTEX_ENVIRONMENT", "development")).strip().lower() in {
        "production", "prod", "staging",
    }


def _require_existing_observation_state() -> bool:
    if _production_environment():
        return True
    configured = os.getenv("CORTEX_RELEASE_CONTROLLER_REQUIRE_EXISTING_STATE", "").strip().lower()
    return configured in {"1", "true", "yes", "on"}


def _controller_role(recipient: str) -> str:
    configured = os.getenv("CORTEX_RELEASE_CONTROLLER_ROLE", "").strip()
    expected = "verifier" if recipient == "release-verifier" else "manager"
    if configured and configured != expected:
        raise RuntimeError(f"release controller role {configured!r} does not match recipient {recipient!r}")
    return expected


def _observation_store() -> _ObservationStore:
    root = Path(os.getenv("CORTEX_RELEASE_CONTROLLER_STATE_DIR", "/tmp/cortex-release-controller"))
    store = _ObservationStore(root)
    if _require_existing_observation_state():
        store._load()
    return store


def _measurement_url(base_url: str) -> str:
    configured = os.getenv("CORTEX_RELEASE_MEASUREMENT_URL", "").strip()
    if _production_environment() and not configured:
        raise RuntimeError("production release controller requires CORTEX_RELEASE_MEASUREMENT_URL")
    return configured or f"{base_url.rstrip('/')}/health"


def _bound_measurement_url(measurement_url: str, release: Dict[str, Any], target_stage: str) -> str:
    parsed = urlsplit(measurement_url)
    query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    binding = {
        "process_id": str(release.get("process_id") or ""),
        "release_id": str(release.get("release_id") or ""),
        "revision_id": str(release.get("revision_id") or ""),
        "target_stage": str(target_stage or ""),
    }
    if any(not value for value in binding.values()):
        raise RuntimeError("release measurement binding is incomplete")
    query.update(binding)
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, urlencode(query), parsed.fragment))


def _verify_verifier_capability(base_url: str) -> bool:
    verifier = os.getenv("CORTEX_RELEASE_VERIFIER_ID", "").strip()
    secret = os.getenv("CORTEX_RELEASE_VERIFIER_ATTESTATION_SECRET", "").strip()
    if not verifier or len(secret.encode("utf-8")) < 32:
        raise RuntimeError("release verifier requires a dedicated ID and 32-byte attestation secret")
    request_id = f"verifier-capability-{uuid4().hex}"
    requested_at = _now_iso()
    response = _post_json(
        base_url,
        "/orchestrator/runtime/delivery/handoffs/verifier-capability",
        {
            "verifier": verifier,
            "request_id": request_id,
            "requested_at": requested_at,
            "verifier_signature": runtime_delivery_verifier_capability_signature(
                verifier=verifier,
                request_id=request_id,
                requested_at=requested_at,
                secret=secret,
            ),
        },
    )
    return bool(
        response.get("success")
        and response.get("capability") == "revision-bound-artifact-attestation"
        and response.get("verifier") == verifier
    )


def _verify_manager_capability(base_url: str, secret: str) -> bool:
    manager_secret = str(secret or "").strip()
    if len(manager_secret.encode("utf-8")) < 32:
        raise RuntimeError("release manager requires a dedicated 32-byte recipient secret")
    request_id = f"manager-capability-{uuid4().hex}"
    requested_at = _now_iso()
    release_id = request_id
    revision_id = "non-mutating"
    idempotency_key = f"capability:{request_id}"
    response = _post_json(
        base_url,
        (
            "/orchestrator/runtime/delivery/handoffs/manager-rollback/"
            f"{RUNTIME_DELIVERY_MANAGER_CAPABILITY_PROCESS_ID}"
        ),
        {
            "release_id": release_id,
            "revision_id": revision_id,
            "idempotency_key": idempotency_key,
            "reason": RUNTIME_DELIVERY_MANAGER_CAPABILITY_REASON,
            "request_id": request_id,
            "requested_at": requested_at,
            "manager_signature": runtime_delivery_manager_rollback_signature(
                process_id=RUNTIME_DELIVERY_MANAGER_CAPABILITY_PROCESS_ID,
                release_id=release_id,
                revision_id=revision_id,
                idempotency_key=idempotency_key,
                reason=RUNTIME_DELIVERY_MANAGER_CAPABILITY_REASON,
                request_id=request_id,
                requested_at=requested_at,
                secret=manager_secret,
            ),
        },
    )
    return bool(
        response.get("success")
        and response.get("capability") == "signed-non-mutating-manager-rollback"
        and response.get("request_id") == request_id
    )


def _probe_measurement(url: str) -> bool:
    request = Request(url, method="GET", headers={"user-agent": "cortex-release-controller/1"})
    try:
        with urlopen(request, timeout=5) as response:
            response.read(1024)
            success = 200 <= int(response.status) < 300
    except (HTTPError, URLError, TimeoutError, OSError):
        success = False
    with _POLL_STATUS_LOCK:
        _POLL_STATUS["last_measurement_at"] = _now_iso()
    return success


def _record_measurement_burst(
    store: _ObservationStore,
    *,
    key: str,
    measurement_url: str,
    count: int = 4,
) -> Dict[str, Any]:
    window: Dict[str, Any] = {}
    for _index in range(max(1, min(int(count), 8))):
        observed_at = time.time()
        window = store.record(
            key,
            success=_probe_measurement(measurement_url),
            observed_at=observed_at,
        )
    return window


def _window_metrics(window: Dict[str, Any]) -> tuple[int, int, float, float]:
    total = int(window.get("total", 0))
    succeeded = int(window.get("succeeded", 0))
    elapsed = max(0, int(float(window.get("last_epoch", 0)) - float(window.get("first_epoch", 0))))
    availability = (succeeded / total) if total else 0.0
    return total, elapsed, availability, 1.0 - availability


def _submit_verifier_evidence(
    base_url: str,
    release: Dict[str, Any],
    window: Dict[str, Any],
) -> Dict[str, Any] | None:
    target_stage = str(release.get("target_stage") or "")
    policy = release_canary_policy(target_stage)
    total, elapsed, availability, error_rate = _window_metrics(window)
    thresholds = dict(policy["thresholds"])
    if total < int(thresholds["minimum_traffic"]) or elapsed < int(thresholds["minimum_observation_seconds"]):
        return None
    verifier_id = os.getenv("CORTEX_RELEASE_VERIFIER_ID", "").strip()
    verifier_secret = os.getenv("CORTEX_RELEASE_VERIFIER_ATTESTATION_SECRET", "").strip()
    if not verifier_id or len(verifier_secret.encode("utf-8")) < 32:
        raise RuntimeError("release verifier requires a dedicated ID and 32-byte attestation secret")
    claims = {
        "policy_id": policy["policy_id"],
        "deployment_id": str(release.get("release_id") or ""),
        "cohort_id": f"{target_stage}:{release.get('revision_id')}",
        "traffic_volume": total,
        "observation_window_seconds": elapsed,
        "artifact_hashes": sorted({
            str(row.get("content_hash") or "")
            for row in (release.get("artifact_receipts") or [])
            if isinstance(row, dict) and row.get("artifact_kind") != "canary_evidence"
        }),
        "metrics": {
            "availability": round(availability, 9),
            "error_rate": round(error_rate, 9),
        },
        "thresholds": thresholds,
    }
    validation_outcome = "passed" if (
        availability >= float(thresholds["minimum_availability"])
        and error_rate <= float(thresholds["maximum_error_rate"])
    ) else "failed"
    _encoded, content_hash = prepare_release_artifact(claims)
    created_at = _now_iso()
    observation_id = f"{int(float(window.get('first_epoch', 0)))}-{content_hash[7:23]}"
    unsigned = {
        "artifact_id": (
            f"evidence:controller:{target_stage}:{release.get('revision_id')}:{observation_id}"
        )[:256],
        "artifact_ref": content_hash,
        "content_hash": content_hash,
        "artifact_kind": "canary_evidence",
        "target_stage": target_stage,
        "candidate_ref": str(release.get("candidate_ref") or ""),
        "release_id": str(release.get("release_id") or ""),
        "revision_id": str(release.get("revision_id") or ""),
        "producer": "cortex-release-observer",
        "verifier": verifier_id,
        "validation_outcome": validation_outcome,
        "claims": claims,
        "created_at": created_at,
    }
    result = _post_json(
        base_url,
        f"/orchestrator/runtime/delivery/artifacts/{release.get('process_id')}",
        {
            "artifact_id": unsigned["artifact_id"],
            "payload": claims,
            "artifact_kind": "canary_evidence",
            "producer": unsigned["producer"],
            "verifier": verifier_id,
            "attestation_signature": release_artifact_attestation_signature(
                unsigned,
                secret=verifier_secret,
            ),
            "validation_outcome": validation_outcome,
            "target_stage": target_stage,
            "claims": claims,
            "created_at": created_at,
        },
    )
    return dict(result.get("receipt") or {})


def _monitor_managed_release(
    base_url: str,
    secret: str,
    store: _ObservationStore,
    release: Dict[str, Any],
    measurement_url: str,
) -> None:
    policy = release_canary_policy("production")
    key = f"manager:{release.get('release_id')}:{release.get('revision_id')}"
    window = _record_measurement_burst(store, key=key, measurement_url=measurement_url)
    total, elapsed, _availability, error_rate = _window_metrics(window)
    thresholds = dict(policy["thresholds"])
    if (
        total < int(thresholds["minimum_traffic"])
        or elapsed < int(thresholds["minimum_observation_seconds"])
        or error_rate < float(thresholds["rollback_error_rate"])
    ):
        return
    request_id = f"rollback-{uuid4().hex}"
    requested_at = _now_iso()
    reason = "post_promotion_health_policy_failure"
    idempotency_key = (
        f"health:{release.get('release_id')}:{release.get('revision_id')}:"
        f"{int(float(window.get('first_epoch', 0)))}"
    )[:256]
    signature = runtime_delivery_manager_rollback_signature(
        process_id=str(release.get("process_id") or ""),
        release_id=str(release.get("release_id") or ""),
        revision_id=str(release.get("revision_id") or ""),
        idempotency_key=idempotency_key,
        reason=reason,
        request_id=request_id,
        requested_at=requested_at,
        secret=secret,
    )
    _post_json(
        base_url,
        f"/orchestrator/runtime/delivery/handoffs/manager-rollback/{release.get('process_id')}",
        {
            "release_id": release.get("release_id"),
            "revision_id": release.get("revision_id"),
            "idempotency_key": idempotency_key,
            "reason": reason,
            "request_id": request_id,
            "requested_at": requested_at,
            "manager_signature": signature,
        },
    )
    store.clear(key)


def _validate_artifact(
    *,
    base_url: str,
    recipient: str,
    secret: str,
    message: AgentMessage,
    receipt: Dict[str, Any],
) -> None:
    artifact_ref = str(receipt.get("artifact_ref") or "")
    request_id = f"artifact-{uuid4().hex}"
    requested_at = _now_iso()
    release_id = str((message.metadata or {}).get("release_id") or "")
    signature = runtime_delivery_artifact_fetch_signature(
        recipient=recipient,
        process_id=message.process_id,
        release_id=release_id,
        revision_id=str(message.revision_id or ""),
        artifact_ref=artifact_ref,
        request_id=request_id,
        requested_at=requested_at,
        secret=secret,
    )
    result = _post_json(
        base_url,
        "/orchestrator/runtime/delivery/handoffs/artifacts/resolve",
        {
            "recipient": recipient,
            "process_id": message.process_id,
            "release_id": release_id,
            "revision_id": message.revision_id,
            "artifact_ref": artifact_ref,
            "request_id": request_id,
            "requested_at": requested_at,
            "recipient_signature": signature,
        },
    )
    encoded = base64.b64decode(str(result.get("payload") or ""), validate=True)
    observed = f"sha256:{hashlib.sha256(encoded).hexdigest()}"
    if observed != artifact_ref or observed != str(receipt.get("content_hash") or ""):
        raise RuntimeError("release artifact content hash mismatch")


def _process_message(base_url: str, recipient: str, secret: str, raw: Dict[str, Any]) -> None:
    message = AgentMessage.model_validate(raw)
    receipts = [dict(row) for row in (message.payload or {}).get("artifact_receipts", []) if isinstance(row, dict)]
    for receipt in receipts:
        _validate_artifact(
            base_url=base_url,
            recipient=recipient,
            secret=secret,
            message=message,
            receipt=receipt,
        )
    target_stage = str((message.metadata or {}).get("target_stage") or "")
    evidence_ids = [
        str(row.get("artifact_id") or "")
        for row in receipts
        if row.get("artifact_kind") == "canary_evidence"
        and row.get("target_stage") == target_stage
        and row.get("validation_outcome") == "passed"
    ]
    if not evidence_ids:
        raise _EvidencePending("no current validated canary evidence accompanies the handoff")
    result_receipt = {
        "result": "approved",
        "candidate_ref": str((message.metadata or {}).get("candidate_ref") or ""),
        "release_id": str((message.metadata or {}).get("release_id") or ""),
        "revision_id": str(message.revision_id or ""),
        "evidence_receipts": evidence_ids,
    }
    signature = agent_acknowledgement_signature(
        message,
        actor=recipient,
        result_receipt=result_receipt,
        secret=secret,
    )
    _post_json(
        base_url,
        f"/orchestrator/runtime/delivery/handoffs/{message.message_id}/acknowledge",
        {
            "recipient": recipient,
            "result_receipt": result_receipt,
            "recipient_signature": signature,
        },
    )


def _poll_once(base_url: str, recipient: str, secret: str) -> None:
    role = _controller_role(recipient)
    observation_store = _observation_store()
    measurement_url = _measurement_url(base_url)
    request_id = f"discover-{uuid4().hex}"
    requested_at = _now_iso()
    signature = runtime_delivery_handoff_discovery_signature(
        recipient=recipient,
        request_id=request_id,
        requested_at=requested_at,
        secret=secret,
    )
    response = _post_json(
        base_url,
        "/orchestrator/runtime/delivery/handoffs/claim-next",
        {
            "recipient": recipient,
            "request_id": request_id,
            "requested_at": requested_at,
            "recipient_signature": signature,
        },
    )
    measurement_verified = _probe_measurement(measurement_url)
    capability_verified = measurement_verified and (
        _verify_verifier_capability(base_url)
        if role == "verifier"
        else _verify_manager_capability(base_url, secret)
    )
    active_observation_keys: set[str] = set()
    if role == "verifier":
        for release in response.get("verification_releases") or []:
            if not isinstance(release, dict):
                continue
            key = (
                f"verifier:{release.get('release_id')}:{release.get('revision_id')}:"
                f"{release.get('target_stage')}"
            )
            active_observation_keys.add(key)
            window = _record_measurement_burst(
                observation_store,
                key=key,
                measurement_url=_bound_measurement_url(
                    measurement_url,
                    release,
                    str(release.get("target_stage") or ""),
                ),
            )
            submitted = _submit_verifier_evidence(base_url, release, window)
            if submitted is not None:
                observation_store.clear(key)
    else:
        for release in response.get("managed_releases") or []:
            if isinstance(release, dict):
                active_observation_keys.add(
                    f"manager:{release.get('release_id')}:{release.get('revision_id')}"
                )
                _monitor_managed_release(
                    base_url,
                    secret,
                    observation_store,
                    release,
                    _bound_measurement_url(
                        measurement_url,
                        release,
                        str(release.get("target_environment") or "production"),
                    ),
                )
    observation_store.retain(active_observation_keys)
    awaiting_evidence = 0
    for raw in response.get("messages") or []:
        if isinstance(raw, dict):
            try:
                _process_message(base_url, recipient, secret, raw)
            except _EvidencePending:
                awaiting_evidence += 1
    with _POLL_STATUS_LOCK:
        _POLL_STATUS["awaiting_evidence_count"] = awaiting_evidence
        _POLL_STATUS["capability_verified"] = capability_verified
    # A successfully authenticated discovery whose available messages were
    # either completed or are waiting only for independent canary evidence
    # proves that the consumer can service the control-plane protocol.
    _record_poll_success()


def _record_poll_success() -> None:
    with _POLL_STATUS_LOCK:
        _POLL_STATUS.update(
            {
                "last_success_epoch": time.time(),
                "last_success_at": _now_iso(),
                "last_error": None,
            }
        )


def _record_poll_error(exc: BaseException) -> None:
    with _POLL_STATUS_LOCK:
        _POLL_STATUS["last_error"] = f"{type(exc).__name__}: {exc}"


def _consumer_readiness() -> Dict[str, Any]:
    try:
        max_age = max(
            5.0,
            min(float(os.getenv("CORTEX_HANDOFF_READY_MAX_AGE_SECONDS", "30")), 300.0),
        )
    except ValueError:
        max_age = 30.0
    with _POLL_STATUS_LOCK:
        snapshot = dict(_POLL_STATUS)
    last_success = snapshot.get("last_success_epoch")
    age = time.time() - float(last_success) if last_success is not None else None
    capability_verified = bool(snapshot.get("capability_verified"))
    ready = age is not None and age <= max_age and (
        capability_verified or not _production_environment()
    )
    return {
        "status": "ready" if ready else "not_ready",
        "ready": ready,
        "last_success_at": snapshot.get("last_success_at"),
        "last_success_age_seconds": round(age, 3) if age is not None else None,
        "maximum_success_age_seconds": max_age,
        "last_error": snapshot.get("last_error"),
        "awaiting_evidence_count": int(snapshot.get("awaiting_evidence_count") or 0),
        "capability_verified": capability_verified,
        "last_measurement_at": snapshot.get("last_measurement_at"),
    }


class _HealthHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/live":
            status = 200
            response = {"status": "live", "live": True}
        elif self.path in {"/ready", "/health"}:
            response = _consumer_readiness()
            status = 200 if response["ready"] else 503
        else:
            status = 404
            response = {"status": "not_found"}
        payload = (json.dumps(response, sort_keys=True) + "\n").encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, _format: str, *_args: Any) -> None:
        return


class _BoundedHealthServer(ThreadingHTTPServer):
    """Bound health sockets before thread creation and deadline all I/O."""

    daemon_threads = True
    request_queue_size = 16

    def __init__(
        self,
        server_address: tuple[str, int],
        handler: type[BaseHTTPRequestHandler],
        *,
        max_connections: int,
        socket_timeout_seconds: float,
    ):
        self._connection_slots = threading.BoundedSemaphore(max_connections)
        self._socket_timeout_seconds = socket_timeout_seconds
        super().__init__(server_address, handler)

    def get_request(self):
        request, client_address = super().get_request()
        request.settimeout(self._socket_timeout_seconds)
        return request, client_address

    def process_request(self, request, client_address) -> None:
        if not self._connection_slots.acquire(blocking=False):
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except BaseException:
            self._connection_slots.release()
            raise

    def process_request_thread(self, request, client_address) -> None:
        try:
            super().process_request_thread(request, client_address)
        finally:
            self._connection_slots.release()


def _bounded_health_int(name: str, default: int, maximum: int) -> int:
    raw = os.getenv(name, str(default)).strip()
    if not raw.isdecimal() or int(raw) <= 0:
        raise RuntimeError(f"{name} must be a positive integer")
    return min(int(raw), maximum)


def _bounded_health_float(name: str, default: float, maximum: float) -> float:
    try:
        value = float(os.getenv(name, str(default)))
    except ValueError as exc:
        raise RuntimeError(f"{name} must be a positive number") from exc
    if not 0 < value <= maximum:
        raise RuntimeError(f"{name} must be between zero and {maximum}")
    return value


def main() -> None:
    recipient = os.getenv("CORTEX_HANDOFF_RECIPIENT", "").strip()
    secret = os.getenv("CORTEX_HANDOFF_RECIPIENT_SECRET", "").strip()
    base_url = os.getenv("CORTEX_BASE_URL", "http://cortex-brain:8888").strip()
    if recipient not in {"release-verifier", "release-manager"}:
        raise RuntimeError("CORTEX_HANDOFF_RECIPIENT must name a required release consumer")
    if len(secret.encode("utf-8")) < 32:
        raise RuntimeError("CORTEX_HANDOFF_RECIPIENT_SECRET must contain at least 32 bytes")
    role = _controller_role(recipient)
    _measurement_url(base_url)
    _observation_store()
    if role == "verifier":
        verifier_id = os.getenv("CORTEX_RELEASE_VERIFIER_ID", "").strip()
        verifier_secret = os.getenv("CORTEX_RELEASE_VERIFIER_ATTESTATION_SECRET", "").strip()
        if not verifier_id or len(verifier_secret.encode("utf-8")) < 32:
            raise RuntimeError(
                "release verifier requires CORTEX_RELEASE_VERIFIER_ID and a dedicated 32-byte attestation secret"
            )
    health_port = int(os.getenv("CORTEX_HANDOFF_HEALTH_PORT", "8891"))
    server = _BoundedHealthServer(
        ("0.0.0.0", health_port),
        _HealthHandler,
        max_connections=_bounded_health_int(
            "CORTEX_HANDOFF_HEALTH_MAX_CONNECTIONS", 16, 64
        ),
        socket_timeout_seconds=_bounded_health_float(
            "CORTEX_HANDOFF_HEALTH_SOCKET_TIMEOUT_SECONDS", 2.0, 5.0
        ),
    )
    threading.Thread(target=server.serve_forever, name="handoff-health", daemon=True).start()
    interval = max(1.0, float(os.getenv("CORTEX_HANDOFF_POLL_SECONDS", "3")))
    while True:
        try:
            _poll_once(base_url, recipient, secret)
        except (HTTPError, URLError, TimeoutError, RuntimeError, ValueError, json.JSONDecodeError) as exc:
            # Authentication, connectivity, protocol, and artifact failures
            # remain visible until a later authenticated poll succeeds.
            _record_poll_error(exc)
        time.sleep(interval)


if __name__ == "__main__":
    main()
