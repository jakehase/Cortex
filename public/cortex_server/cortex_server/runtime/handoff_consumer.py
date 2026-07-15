"""Standalone authenticated release handoff consumer used by production Compose."""

from __future__ import annotations

import base64
import hashlib
import json
import os
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from uuid import uuid4

from cortex_server.runtime.agent_mailbox import AgentMessage, agent_acknowledgement_signature
from cortex_server.runtime.production_build_loop import (
    runtime_delivery_artifact_fetch_signature,
    runtime_delivery_handoff_discovery_signature,
)


_POLL_STATUS_LOCK = threading.Lock()
_POLL_STATUS: Dict[str, Any] = {
    "last_success_epoch": None,
    "last_success_at": None,
    "last_error": "authenticated poll has not succeeded",
    "awaiting_evidence_count": 0,
}


class _EvidencePending(RuntimeError):
    """A claimed handoff is healthy but its stage evidence is not ready yet."""


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _post_json(base_url: str, path: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    request = Request(
        f"{base_url.rstrip('/')}{path}",
        data=json.dumps(payload, sort_keys=True).encode("utf-8"),
        headers={"content-type": "application/json"},
        method="POST",
    )
    with urlopen(request, timeout=15) as response:
        result = json.loads(response.read().decode("utf-8"))
    if not isinstance(result, dict):
        raise RuntimeError("handoff API returned a non-object response")
    return result


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
    awaiting_evidence = 0
    for raw in response.get("messages") or []:
        if isinstance(raw, dict):
            try:
                _process_message(base_url, recipient, secret, raw)
            except _EvidencePending:
                awaiting_evidence += 1
    with _POLL_STATUS_LOCK:
        _POLL_STATUS["awaiting_evidence_count"] = awaiting_evidence
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
    ready = age is not None and age <= max_age
    return {
        "status": "ready" if ready else "not_ready",
        "ready": ready,
        "last_success_at": snapshot.get("last_success_at"),
        "last_success_age_seconds": round(age, 3) if age is not None else None,
        "maximum_success_age_seconds": max_age,
        "last_error": snapshot.get("last_error"),
        "awaiting_evidence_count": int(snapshot.get("awaiting_evidence_count") or 0),
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


def main() -> None:
    recipient = os.getenv("CORTEX_HANDOFF_RECIPIENT", "").strip()
    secret = os.getenv("CORTEX_HANDOFF_RECIPIENT_SECRET", "").strip()
    base_url = os.getenv("CORTEX_BASE_URL", "http://cortex-brain:8888").strip()
    if recipient not in {"release-verifier", "release-manager"}:
        raise RuntimeError("CORTEX_HANDOFF_RECIPIENT must name a required release consumer")
    if len(secret.encode("utf-8")) < 32:
        raise RuntimeError("CORTEX_HANDOFF_RECIPIENT_SECRET must contain at least 32 bytes")
    health_port = int(os.getenv("CORTEX_HANDOFF_HEALTH_PORT", "8891"))
    server = ThreadingHTTPServer(("0.0.0.0", health_port), _HealthHandler)
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
