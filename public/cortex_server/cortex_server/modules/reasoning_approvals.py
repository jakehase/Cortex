from __future__ import annotations

import json
import hashlib
import hmac
import os
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional
from uuid import uuid4

from cortex_server.modules.reasoning_store import list_docs, replace_namespace_docs


DEFAULT_STATE_PATH = Path(os.getenv("REASONING_APPROVALS_STATE_PATH", "/opt/clawdbot/state/reasoning_approvals.json"))
DEFAULT_DB_PATH = Path(os.getenv("REASONING_STORE_DB_PATH", "/opt/clawdbot/state/reasoning_runtime.db"))
ENABLE_LEGACY_JSON_FALLBACK = str(os.getenv("REASONING_APPROVALS_ENABLE_LEGACY_JSON_FALLBACK", "0")).strip().lower() in {"1", "true", "yes", "on"}
_NAMESPACE = "approval_grants"
_LOCK = threading.RLock()
_LIST_BINDINGS = ("node_ids", "endpoint_prefixes", "methods", "risk_levels")
_BINDING_VERSION = "cortex.reasoning.approval.binding.v2"
_SIGNATURE_VERSION = "cortex.reasoning.approval.signature.v1"
_SERVER_PERSISTED_TRUST = "server_persisted"
_SIGNED_TRUST = "independently_signed"
_MAX_NONCE_LENGTH = 256
_CONSUMPTION_TABLE = "reasoning_approval_consumptions"


class ReasoningApprovalError(ValueError):
    pass



def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()



def _state_path() -> Path:
    return Path(str(DEFAULT_STATE_PATH))



def _db_path() -> Path:
    return Path(str(DEFAULT_DB_PATH))



def _default_state() -> Dict[str, Any]:
    return {
        "version": "cortex.reasoning.approvals.v1",
        "updated_at": _now_iso(),
        "grants": [],
    }



def _legacy_state() -> Optional[Dict[str, Any]]:
    path = _state_path()
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            data.setdefault("version", "cortex.reasoning.approvals.v1")
            data.setdefault("updated_at", _now_iso())
            data.setdefault("grants", [])
            for row in data.get("grants") or []:
                if isinstance(row, dict):
                    # Legacy JSON has no trusted issuance boundary.  Migration
                    # preserves it for audit/listing but never as authority.
                    row["trust_source"] = "legacy_untrusted"
            return data
    except Exception:
        return None
    return None



def load_state() -> Dict[str, Any]:
    with _LOCK:
        grants = [dict(row) for row in list_docs(_NAMESPACE, db_path=_db_path()) if isinstance(row, dict)]
        if grants:
            return {
                "version": "cortex.reasoning.approvals.v1",
                "updated_at": _now_iso(),
                "grants": grants,
            }
        if not ENABLE_LEGACY_JSON_FALLBACK:
            return _default_state()
        legacy = _legacy_state()
        if legacy:
            save_state(legacy)
            return legacy
        return _default_state()



def save_state(state: Dict[str, Any]) -> Dict[str, Any]:
    grants = [dict(row) for row in (state.get("grants") or []) if isinstance(row, dict)]
    # The generic document store supplies created_at for ordinary documents.
    # Suppress that behavior here: for grants it is authorization provenance,
    # and persisting an old malformed row must not manufacture provenance.
    for grant in grants:
        grant.setdefault("created_at", None)
    state["updated_at"] = _now_iso()
    with _LOCK:
        replace_namespace_docs(_NAMESPACE, grants, id_field="grant_id", db_path=_db_path())
    return state



def _parse_ts(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        return None


def approval_principal_id(workflow_metadata: Optional[Dict[str, Any]]) -> str:
    """Return the workflow principal to which an approval must be bound.

    The value may be selected by a caller when a workflow is authored, but it
    cannot confer authority by itself: a trusted grant must independently bind
    the same value and the server-generated workflow id plus exact action.
    """
    metadata = dict(workflow_metadata or {})
    for key in ("authenticated_principal_id", "principal_id"):
        value = str(metadata.get(key) or "").strip()
        if value:
            return value
    principal = metadata.get("principal") if isinstance(metadata.get("principal"), dict) else {}
    for key in ("authenticated_principal_id", "principal_id", "id"):
        value = str((principal or {}).get(key) or "").strip()
        if value:
            return value
    owner = str(metadata.get("owner") or "").strip()
    session_key = str(metadata.get("session_key") or "").strip()
    if owner and session_key:
        return f"owner:{owner}|session:{session_key}"
    return ""


def approval_action_target(step: Dict[str, Any]) -> str:
    step_metadata = step.get("metadata") if isinstance(step.get("metadata"), dict) else {}
    for key in ("approval_target", "action_target"):
        value = str((step_metadata or {}).get(key) or "").strip()
        if value:
            return value
    payload = step.get("payload") if isinstance(step.get("payload"), dict) else {}
    for key in (
        "target",
        "recipient",
        "recipients",
        "destination",
        "to",
        "url",
        "path",
        "repo_path",
        "device_id",
        "entity_id",
        "container_id",
        "host",
    ):
        if key not in payload or payload.get(key) in (None, "", []):
            continue
        value = payload.get(key)
        try:
            canonical_value = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)
        except (TypeError, ValueError):
            return ""
        return f"{key}:{canonical_value}"
    return str(step.get("endpoint") or "").strip()


def approval_action_digest(step: Dict[str, Any]) -> str:
    """Digest the exact node, method, endpoint, headers, resolved payload, and target."""
    action = {
        "node_id": str(step.get("node_id") or ""),
        "method": str(step.get("method") or "POST").upper(),
        "endpoint": str(step.get("endpoint") or ""),
        "payload": step.get("payload", {}),
        "headers": step.get("headers", {}),
        "target": approval_action_target(step),
    }
    try:
        canonical = json.dumps(action, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)
    except (TypeError, ValueError):
        return ""
    return f"sha256:{hashlib.sha256(canonical.encode('utf-8')).hexdigest()}"


def _binding_complete(grant: Dict[str, Any]) -> bool:
    required = ("principal_id", "workflow_id", "action_digest", "target", "nonce", "expires_at")
    if any(not str(grant.get(field) or "").strip() for field in required):
        return False
    if str(grant.get("binding_version") or "") != _BINDING_VERSION:
        return False
    if len(str(grant.get("principal_id") or "")) > 256 or len(str(grant.get("workflow_id") or "")) > 256:
        return False
    action_digest = str(grant.get("action_digest") or "")
    if len(action_digest) != 71 or not action_digest.startswith("sha256:"):
        return False
    try:
        int(action_digest.removeprefix("sha256:"), 16)
    except ValueError:
        return False
    if len(str(grant.get("target") or "")) > 2048:
        return False
    nonce = str(grant.get("nonce") or "")
    if len(nonce) > _MAX_NONCE_LENGTH:
        return False
    expires_at = _parse_ts(grant.get("expires_at"))
    return expires_at is not None



def _string_binding(
    value: Any, *, transform: Optional[Callable[[str], str]] = None
) -> Optional[List[str]]:
    """Return a normalized string binding, or None when its shape is unsafe."""
    if not isinstance(value, (list, tuple)):
        return None
    if any(not isinstance(item, str) or not item.strip() for item in value):
        return None
    if transform is None:
        return list(value)
    return [transform(item) for item in value]


def _endpoint_prefix_binding(value: Any) -> Optional[List[str]]:
    prefixes = _string_binding(value)
    if prefixes is None:
        return None
    normalized: List[str] = []
    for prefix in prefixes:
        # A prefix is an absolute URL path. Preserve the historically accepted
        # trailing slash, but reject ambiguous repeated-slash forms rather than
        # allowing rstrip() to turn them into an empty authorization boundary.
        if not prefix.startswith("/") or "//" in prefix:
            return None
        normalized.append(prefix if prefix == "/" else prefix.rstrip("/"))
    return normalized


def _normalized_bindings(grant: Dict[str, Any]) -> Optional[Dict[str, List[str]]]:
    transforms = {"methods": str.upper, "risk_levels": str.lower}
    bindings: Dict[str, List[str]] = {}
    for field in _LIST_BINDINGS:
        if field == "endpoint_prefixes":
            value = _endpoint_prefix_binding(grant.get(field))
        else:
            value = _string_binding(grant.get(field), transform=transforms.get(field))
        if value is None:
            return None
        bindings[field] = value
    return bindings


def _normalize_grant(grant: Dict[str, Any], *, new: bool = False) -> Dict[str, Any]:
    out = dict(grant or {})
    out.setdefault("grant_id", f"grant_{uuid4().hex[:12]}")
    # Provenance may only be minted while creating a grant. Persisted rows must
    # retain a missing/malformed timestamp so authorization fails closed.
    if new:
        out.setdefault("created_at", _now_iso())
    out.setdefault("granted_by", "human")
    out.setdefault("scope", "workflow")
    out.setdefault("workflow_id", None)
    out.setdefault("task_id", None)
    out.setdefault("node_ids", [])
    out.setdefault("endpoint_prefixes", [])
    out.setdefault("methods", [])
    out.setdefault("risk_levels", [])
    out.setdefault("expires_at", None)
    out.setdefault("revoked_at", None)
    out.setdefault("principal_id", None)
    out.setdefault("action_digest", None)
    out.setdefault("target", None)
    out.setdefault("nonce", None)
    out.setdefault("binding_version", None)
    out.setdefault("trust_source", None)
    out.setdefault("issuer", None)
    out.setdefault("key_id", None)
    out.setdefault("signature", None)
    out.setdefault("note", None)
    out.setdefault("metadata", {})
    bindings = _normalized_bindings(out)
    if bindings is None:
        if new:
            raise ReasoningApprovalError(
                "approval bindings must be lists or tuples containing only nonblank strings"
            )
        # Keep malformed persisted values intact so later authorization can
        # detect them and fail closed rather than laundering them into a grant.
    else:
        out.update(bindings)
    out["metadata"] = dict(out.get("metadata") or {})
    out["binding_complete"] = _binding_complete(out)
    return out


def _signature_payload(grant: Dict[str, Any]) -> bytes:
    normalized = _normalize_grant(grant)
    signed_fields = {
        "version": _SIGNATURE_VERSION,
        "binding_version": normalized.get("binding_version"),
        "grant_id": normalized.get("grant_id"),
        "granted_by": normalized.get("granted_by"),
        "issuer": normalized.get("issuer"),
        "key_id": normalized.get("key_id"),
        "principal_id": normalized.get("principal_id"),
        "workflow_id": normalized.get("workflow_id"),
        "task_id": normalized.get("task_id"),
        "scope": normalized.get("scope"),
        "node_ids": normalized.get("node_ids"),
        "endpoint_prefixes": normalized.get("endpoint_prefixes"),
        "methods": normalized.get("methods"),
        "risk_levels": normalized.get("risk_levels"),
        "action_digest": normalized.get("action_digest"),
        "target": normalized.get("target"),
        "nonce": normalized.get("nonce"),
        "expires_at": normalized.get("expires_at"),
        "revoked_at": normalized.get("revoked_at"),
    }
    return json.dumps(signed_fields, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def approval_grant_signature(grant: Dict[str, Any], *, secret: str) -> str:
    signing_secret = str(secret or "")
    if not signing_secret:
        return ""
    return hmac.new(signing_secret.encode("utf-8"), _signature_payload(grant), hashlib.sha256).hexdigest()


def _configured_signing_keys() -> Dict[str, Dict[str, str]]:
    raw = str(os.getenv("REASONING_APPROVAL_SIGNING_KEYS") or "").strip()
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    if not isinstance(parsed, dict):
        return {}
    keys: Dict[str, Dict[str, str]] = {}
    for raw_key_id, raw_config in parsed.items():
        key_id = str(raw_key_id or "").strip()
        if not key_id:
            continue
        if isinstance(raw_config, str):
            secret = raw_config.strip()
            issuer = key_id
        elif isinstance(raw_config, dict):
            secret = str(raw_config.get("secret") or "").strip()
            issuer = str(raw_config.get("issuer") or key_id).strip()
        else:
            continue
        if secret and issuer:
            keys[key_id] = {"secret": secret, "issuer": issuer}
    return keys


def _has_valid_independent_signature(grant: Dict[str, Any]) -> bool:
    normalized = _normalize_grant(grant)
    if not _binding_complete(normalized):
        return False
    key_id = str(normalized.get("key_id") or "").strip()
    key = _configured_signing_keys().get(key_id)
    if not key or str(normalized.get("issuer") or "").strip() != key["issuer"]:
        return False
    supplied = str(normalized.get("signature") or "").strip()
    expected = approval_grant_signature(normalized, secret=key["secret"])
    return bool(supplied and hmac.compare_digest(supplied, expected))



def create_approval_grant(**kwargs: Any) -> Dict[str, Any]:
    with _LOCK:
        state = load_state()
        grants = state.setdefault("grants", [])
        trusted = dict(kwargs)
        trusted["binding_version"] = _BINDING_VERSION
        trusted["trust_source"] = _SERVER_PERSISTED_TRUST
        grant = _normalize_grant(trusted, new=True)
        grants.append(grant)
        if len(grants) > 1000:
            del grants[:-1000]
        save_state(state)
        return dict(grant)



def get_approval_grant(grant_id: str) -> Optional[Dict[str, Any]]:
    for row in load_state().get("grants") or []:
        if isinstance(row, dict) and str(row.get("grant_id") or "") == str(grant_id):
            return _normalize_grant(row)
    return None



def list_approval_grants(*, include_revoked: bool = False) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for row in load_state().get("grants") or []:
        if not isinstance(row, dict):
            continue
        grant = _normalize_grant(row)
        if not include_revoked and grant.get("revoked_at"):
            continue
        out.append(grant)
    return out



def revoke_approval_grant(grant_id: str) -> Dict[str, Any]:
    with _LOCK:
        state = load_state()
        for row in state.get("grants") or []:
            if isinstance(row, dict) and str(row.get("grant_id") or "") == str(grant_id):
                row["revoked_at"] = _now_iso()
                save_state(state)
                return _normalize_grant(row)
    raise ReasoningApprovalError(f"unknown approval grant: {grant_id}")



def _is_active(grant: Dict[str, Any], *, now_iso: Optional[str] = None) -> bool:
    if grant.get("revoked_at"):
        return False
    # A durable grant must carry a parseable provenance timestamp. Missing or
    # corrupted provenance on a persisted row fails closed. Independently
    # signed grants instead derive issuance trust from the configured signer;
    # their signed, mandatory expiry bounds their lifetime.
    if (
        grant.get("resolved_trust") != _SIGNED_TRUST
        and _parse_ts(grant.get("created_at")) is None
    ):
        return False
    now_dt = _parse_ts(now_iso) or datetime.now(timezone.utc)
    raw_expires_at = grant.get("expires_at")
    expires_at = _parse_ts(raw_expires_at)
    if raw_expires_at and expires_at is None:
        return False
    if expires_at and expires_at <= now_dt:
        return False
    return True



def resolve_approval_grants(workflow_metadata: Optional[Dict[str, Any]] = None, step: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
    workflow_metadata = dict(workflow_metadata or {})
    step = dict(step or {})
    out: List[Dict[str, Any]] = []
    seen: set[str] = set()

    step_metadata = step.get("metadata") if isinstance(step.get("metadata"), dict) else {}
    # Embedded grant bodies are untrusted input unless an independently
    # configured issuer signed every exact binding. Ordinary callers may only
    # nominate server-persisted grants by ID.
    embedded: List[Any] = []
    for candidates in (
        workflow_metadata.get("approval_grants"),
        (step_metadata or {}).get("approval_grants"),
    ):
        if isinstance(candidates, (list, tuple)):
            embedded.extend(candidates)
    for item in embedded:
        if isinstance(item, dict) and _has_valid_independent_signature(item):
            grant = _normalize_grant(item)
            gid = str(grant.get("grant_id") or "")
            if gid and gid not in seen:
                grant["resolved_trust"] = _SIGNED_TRUST
                seen.add(gid)
                out.append(grant)

    grant_ids: List[str] = []
    for candidates in (
        workflow_metadata.get("approval_grant_ids"),
        (step_metadata or {}).get("approval_grant_ids"),
    ):
        if not isinstance(candidates, (list, tuple)):
            continue
        if any(not isinstance(candidate, str) or not candidate.strip() for candidate in candidates):
            continue
        grant_ids.extend(candidates)
    for grant_id in grant_ids:
        grant = get_approval_grant(grant_id)
        if grant and grant_id not in seen:
            if str(grant.get("trust_source") or "") != _SERVER_PERSISTED_TRUST:
                continue
            grant["resolved_trust"] = _SERVER_PERSISTED_TRUST
            seen.add(grant_id)
            out.append(grant)

    return out



def grant_allows_step(
    step: Dict[str, Any],
    *,
    workflow_metadata: Optional[Dict[str, Any]] = None,
    risk: Optional[str] = None,
    required_scope: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    workflow_metadata = dict(workflow_metadata or {})
    method = str(step.get("method") or "POST").upper()
    endpoint = str(step.get("endpoint") or "")
    node_id = str(step.get("node_id") or "")
    workflow_id = str(workflow_metadata.get("workflow_id") or "")
    task_id = str(workflow_metadata.get("task_id") or workflow_metadata.get("kernel_task_id") or "")
    risk_value = str(risk or "").lower().strip()
    expected_principal_id = approval_principal_id(workflow_metadata)
    expected_action_digest = approval_action_digest(step)
    expected_target = approval_action_target(step)

    # Every trusted approval is exact and closed: no wildcard workflow,
    # principal, target, digest, nonce, or expiry fields are accepted.
    if not workflow_id or not node_id or not expected_principal_id or not expected_action_digest or not expected_target:
        return None

    for grant in resolve_approval_grants(workflow_metadata, step):
        if grant.get("resolved_trust") not in {_SERVER_PERSISTED_TRUST, _SIGNED_TRUST}:
            continue
        if not _binding_complete(grant):
            continue
        if not _is_active(grant):
            continue
        bindings = _normalized_bindings(grant)
        if bindings is None:
            continue
        if str(grant.get("principal_id") or "") != expected_principal_id:
            continue
        if str(grant.get("workflow_id") or "") != workflow_id:
            continue
        if str(grant.get("action_digest") or "") != expected_action_digest:
            continue
        if str(grant.get("target") or "") != expected_target:
            continue
        if not str(grant.get("nonce") or "").strip():
            continue
        if required_scope and str(grant.get("scope") or "") != str(required_scope):
            continue
        grant_workflow_id = str(grant.get("workflow_id") or "")
        if grant_workflow_id != workflow_id:
            continue
        grant_task_id = str(grant.get("task_id") or "")
        if grant_task_id and grant_task_id != task_id:
            continue
        node_ids = bindings["node_ids"]
        if node_ids and node_id not in node_ids:
            continue
        endpoint_prefixes = bindings["endpoint_prefixes"]
        if endpoint_prefixes and not any(
            (prefix == "/" and endpoint.startswith("/"))
            or endpoint == prefix
            or endpoint.startswith(prefix + "/")
            for prefix in endpoint_prefixes
        ):
            continue
        methods = bindings["methods"]
        if methods and method not in methods:
            continue
        risk_levels = bindings["risk_levels"]
        if risk_levels and risk_value not in risk_levels:
            continue
        scope = str(grant.get("scope") or "workflow")
        if scope == "step" and (not node_ids or not node_id or node_id not in node_ids):
            continue
        if scope == "endpoint" and not endpoint_prefixes:
            continue
        if scope == "risk_class" and (not risk_levels or not risk_value or risk_value not in risk_levels):
            continue
        return grant
    return None


def consume_approval_grant(
    grant: Dict[str, Any],
    *,
    step: Dict[str, Any],
    workflow_metadata: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Atomically consume one approval nonce immediately before its sink call."""
    workflow_metadata = dict(workflow_metadata or {})
    normalized = _normalize_grant(grant)
    expected = {
        "principal_id": approval_principal_id(workflow_metadata),
        "workflow_id": str(workflow_metadata.get("workflow_id") or ""),
        "action_digest": approval_action_digest(step),
        "target": approval_action_target(step),
    }
    if normalized.get("resolved_trust") not in {_SERVER_PERSISTED_TRUST, _SIGNED_TRUST}:
        return {"consumed": False, "reason": "untrusted_grant"}
    if not _binding_complete(normalized) or not _is_active(normalized):
        return {"consumed": False, "reason": "inactive_or_incomplete_grant"}
    if any(str(normalized.get(field) or "") != value for field, value in expected.items()):
        return {"consumed": False, "reason": "approval_binding_mismatch"}

    nonce = str(normalized.get("nonce") or "")
    nonce_digest = hashlib.sha256(nonce.encode("utf-8")).hexdigest()
    consumed_at = _now_iso()
    path = _db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    timeout = max(0.1, float(os.getenv("REASONING_STORE_SQLITE_TIMEOUT_SECONDS", "2.5")))
    busy_timeout_ms = max(0, int(os.getenv("REASONING_STORE_SQLITE_BUSY_TIMEOUT_MS", "2500")))
    conn: Optional[sqlite3.Connection] = None
    try:
        conn = sqlite3.connect(str(path), timeout=timeout)
        conn.execute(f"PRAGMA busy_timeout={busy_timeout_ms}")
        conn.execute("BEGIN IMMEDIATE")
        conn.execute(
            f"""
            CREATE TABLE IF NOT EXISTS {_CONSUMPTION_TABLE} (
                nonce_digest TEXT PRIMARY KEY,
                grant_id TEXT NOT NULL,
                workflow_id TEXT NOT NULL,
                principal_id_sha256 TEXT NOT NULL,
                action_digest TEXT NOT NULL,
                target_sha256 TEXT NOT NULL,
                consumed_at TEXT NOT NULL
            )
            """
        )
        cursor = conn.execute(
            f"""
            INSERT OR IGNORE INTO {_CONSUMPTION_TABLE}(
                nonce_digest, grant_id, workflow_id, principal_id_sha256,
                action_digest, target_sha256, consumed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                nonce_digest,
                str(normalized.get("grant_id") or ""),
                expected["workflow_id"],
                hashlib.sha256(expected["principal_id"].encode("utf-8")).hexdigest(),
                expected["action_digest"],
                hashlib.sha256(expected["target"].encode("utf-8")).hexdigest(),
                consumed_at,
            ),
        )
        consumed = cursor.rowcount == 1
        conn.commit()
    except (OSError, sqlite3.Error, TypeError, ValueError) as exc:
        if conn is not None:
            conn.rollback()
        return {"consumed": False, "reason": "consumption_store_unavailable", "error": type(exc).__name__}
    finally:
        if conn is not None:
            conn.close()

    return {
        "consumed": consumed,
        "reason": "consumed" if consumed else "approval_replayed",
        "grant_id": normalized.get("grant_id"),
        "nonce_digest": nonce_digest,
        "consumed_at": consumed_at if consumed else None,
    }


__all__ = [
    "ReasoningApprovalError",
    "approval_action_digest",
    "approval_action_target",
    "approval_grant_signature",
    "approval_principal_id",
    "consume_approval_grant",
    "create_approval_grant",
    "get_approval_grant",
    "grant_allows_step",
    "list_approval_grants",
    "load_state",
    "resolve_approval_grants",
    "revoke_approval_grant",
    "save_state",
]
