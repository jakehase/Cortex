"""Short-lived, principal-bound authorization for direct external actions.

The global write token is deliberately only a transport credential.  A route
that can enqueue work, actuate a device, or send data outside Cortex must also
consume one of these capabilities immediately before entering its sink.
"""

from __future__ import annotations

from dataclasses import dataclass, field
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import sqlite3
import secrets
import time
from typing import Any, Mapping, Optional

from fastapi import HTTPException, Request


ACTION_CAPABILITY_VERSION = "cortex.action.capability.v1"
ACTION_HEADERS = {
    "nonce": "x-cortex-action-nonce",
    "issued_at": "x-cortex-action-issued-at",
    "expires_at": "x-cortex-action-expires-at",
    "signature": "x-cortex-action-signature",
}
DELEGATED_ACTION_CAPABILITY_HEADER = "cortex-delegated-action-capability"
DEFAULT_ACTION_CAPABILITY_DB_PATH = Path(
    "/opt/clawdbot/state/action_capabilities.db"
)
_PRINCIPAL_FIELDS = (
    "tenant_id",
    "workspace_id",
    "agent_id",
    "user_id",
    "channel_id",
    "session_id",
)
_OPAQUE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$")
_NONCE_RE = re.compile(r"^[A-Za-z0-9_-]{16,128}$")
_MAX_TTL_SECONDS = 120
_CLOCK_SKEW_SECONDS = 15
_CONSUMPTION_TABLE = "action_capability_consumptions"
_DEFERRED_TABLE = "deferred_action_capability_state"
_DEFERRED_VERSION = "cortex.deferred-action.capability.v1"
_MAX_DEFERRED_TTL_SECONDS = 30 * 24 * 60 * 60
_MAX_DEFERRED_RUNS = 1000
_AUTHORIZATION_SEAL = object()
_ACTION_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})


@dataclass(frozen=True)
class ActionAuthorization:
    """Opaque proof that the exact request capability was consumed."""

    principal_id: str
    action_digest: str
    method: str
    path: str
    body_sha256: str
    canonical_body_sha256: str
    nonce_digest: str
    expires_at: int
    scope: str
    _json_field_digests: tuple[tuple[str, str], ...] = field(
        repr=False,
        compare=False,
    )
    _seal: object


def _bounded_text(value: Any, field: str, *, allow_empty: bool = False) -> str:
    text = str(value or "").strip()
    if allow_empty and not text:
        return ""
    if not _OPAQUE_RE.fullmatch(text):
        raise ValueError(f"{field} must be a bounded opaque identifier")
    return text


def _principal_values(principal: Any) -> tuple[str, dict[str, str]]:
    role = _bounded_text(getattr(principal, "role", ""), "principal role")
    credential_id = _bounded_text(
        getattr(principal, "credential_id", ""), "principal credential id"
    )
    values = {
        field: _bounded_text(
            getattr(principal, field, ""),
            field,
            allow_empty=role in {"admin", "codec_admin"},
        )
        for field in _PRINCIPAL_FIELDS
    }
    if role == "principal" and any(not value for value in values.values()):
        raise ValueError("action principal scope is incomplete")
    if role not in {"principal", "admin", "codec_admin"}:
        raise ValueError("unsupported action principal role")
    principal_id = "|".join(
        [f"role:{role}", f"credential:{credential_id}"]
        + [f"{field}:{values[field]}" for field in _PRINCIPAL_FIELDS]
    )
    return principal_id, values


def normalize_action_policy_rules(values: Any) -> tuple[str, ...]:
    """Validate exact or trailing-wildcard ``METHOD:/path`` action rules."""

    if values is None:
        return ()
    if not isinstance(values, (list, tuple)):
        raise ValueError("allowed_actions must be a list of method:path rules")
    normalized: set[str] = set()
    for raw in values:
        rule = str(raw or "").strip()
        method, separator, path = rule.partition(":")
        method = method.upper()
        if not separator or method not in _ACTION_METHODS:
            raise ValueError(f"invalid allowed action rule: {rule!r}")
        if not path.startswith("/") or "\n" in path or len(path) > 2049:
            raise ValueError(f"invalid allowed action rule: {rule!r}")
        if "*" in path and (not path.endswith("/*") or path.count("*") != 1):
            raise ValueError(f"invalid allowed action rule: {rule!r}")
        normalized.add(f"{method}:{path}")
    return tuple(sorted(normalized))


def action_policy_allows(rules: Any, *, method: str, path: str) -> bool:
    """Return whether a server-owned credential policy admits one action."""

    normalized_method = str(method or "").strip().upper()
    normalized_path = str(path or "").strip()
    if normalized_method not in _ACTION_METHODS or not normalized_path.startswith("/"):
        return False
    for rule in rules if isinstance(rules, (list, tuple)) else ():
        rule_method, separator, rule_path = str(rule or "").partition(":")
        if not separator or rule_method != normalized_method:
            continue
        if rule_path.endswith("/*"):
            if normalized_path.startswith(rule_path[:-1]):
                return True
        elif hmac.compare_digest(rule_path, normalized_path):
            return True
    return False


def body_sha256(body: bytes) -> str:
    return hashlib.sha256(bytes(body)).hexdigest()


def canonical_json_sha256(value: Any) -> str:
    """Fingerprint a JSON value exactly as sink-binding checks compare it."""

    encoded = json.dumps(
        value,
        allow_nan=False,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _json_field_digests(body: bytes) -> tuple[tuple[str, str], ...]:
    try:
        payload = json.loads(bytes(body).decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return ()
    if not isinstance(payload, dict):
        return ()
    try:
        return tuple(
            sorted(
                (str(key), canonical_json_sha256(value))
                for key, value in payload.items()
            )
        )
    except (TypeError, ValueError):
        return ()


def _canonical_body_sha256(body: bytes) -> str:
    try:
        return canonical_json_sha256(json.loads(bytes(body).decode("utf-8")))
    except (UnicodeDecodeError, json.JSONDecodeError, TypeError, ValueError):
        return body_sha256(body)


def canonical_action_message(
    *,
    principal: Any,
    method: str,
    path: str,
    body: bytes,
    nonce: str,
    issued_at: int,
    expires_at: int,
) -> bytes:
    principal_id, _values = _principal_values(principal)
    normalized_method = str(method or "").strip().upper()
    normalized_path = str(path or "").strip()
    if normalized_method not in {"POST", "PUT", "PATCH", "DELETE"}:
        raise ValueError("action method is not mutating")
    if not normalized_path.startswith("/") or "\n" in normalized_path or len(normalized_path) > 2048:
        raise ValueError("action path is invalid")
    if not _NONCE_RE.fullmatch(str(nonce or "")):
        raise ValueError("action nonce is invalid")
    return "\n".join(
        (
            ACTION_CAPABILITY_VERSION,
            principal_id,
            normalized_method,
            normalized_path,
            f"sha256:{body_sha256(body)}",
            str(nonce),
            str(int(issued_at)),
            str(int(expires_at)),
        )
    ).encode("utf-8")


def action_signature(
    *,
    secret: str,
    principal: Any,
    method: str,
    path: str,
    body: bytes,
    nonce: str,
    issued_at: int,
    expires_at: int,
) -> str:
    signing_secret = str(secret or "")
    if len(signing_secret.encode("utf-8")) < 16:
        return ""
    message = canonical_action_message(
        principal=principal,
        method=method,
        path=path,
        body=body,
        nonce=nonce,
        issued_at=issued_at,
        expires_at=expires_at,
    )
    return hmac.new(signing_secret.encode("utf-8"), message, hashlib.sha256).hexdigest()


def action_capability_headers(
    *,
    secret: str,
    principal: Any,
    method: str,
    path: str,
    body: bytes,
    nonce: str,
    issued_at: int,
    expires_at: int,
) -> dict[str, str]:
    """Build headers for trusted callers and focused regression fixtures."""

    signature = action_signature(
        secret=secret,
        principal=principal,
        method=method,
        path=path,
        body=body,
        nonce=nonce,
        issued_at=issued_at,
        expires_at=expires_at,
    )
    if not signature:
        raise ValueError("action capability secret is unavailable")
    return {
        ACTION_HEADERS["nonce"]: nonce,
        ACTION_HEADERS["issued_at"]: str(int(issued_at)),
        ACTION_HEADERS["expires_at"]: str(int(expires_at)),
        ACTION_HEADERS["signature"]: signature,
    }


def _consume_nonce(
    *,
    db_path: Path,
    nonce: str,
    principal_id: str,
    action_digest: str,
    expires_at: int,
) -> tuple[bool, str]:
    if not db_path.is_absolute():
        raise HTTPException(
            status_code=503,
            detail="action replay protection is unavailable",
        )
    # Replay identity is principal-scoped: another credential must not be able
    # to reserve a victim's otherwise-valid nonce and cause cross-principal
    # denial of service.
    principal_sha256 = hashlib.sha256(principal_id.encode("utf-8")).hexdigest()
    nonce_digest = hashlib.sha256(
        f"{principal_id}\0{nonce}".encode("utf-8")
    ).hexdigest()
    legacy_nonce_digest = hashlib.sha256(nonce.encode("utf-8")).hexdigest()
    now = int(time.time())
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn: Optional[sqlite3.Connection] = None
    try:
        conn = sqlite3.connect(str(db_path), timeout=2.5)
        conn.execute("PRAGMA busy_timeout=2500")
        conn.execute("BEGIN IMMEDIATE")
        conn.execute(
            f"""
            CREATE TABLE IF NOT EXISTS {_CONSUMPTION_TABLE} (
                nonce_digest TEXT PRIMARY KEY,
                principal_sha256 TEXT NOT NULL,
                action_digest TEXT NOT NULL,
                expires_at INTEGER NOT NULL,
                consumed_at INTEGER NOT NULL
            )
            """
        )
        conn.execute(
            f"DELETE FROM {_CONSUMPTION_TABLE} WHERE expires_at <= ?",
            (now,),
        )
        # Honor receipts consumed before principal-scoped nonce hashing was
        # introduced, but do not let another principal's legacy row block this
        # principal.
        legacy_row = conn.execute(
            f"SELECT principal_sha256 FROM {_CONSUMPTION_TABLE} WHERE nonce_digest = ?",
            (legacy_nonce_digest,),
        ).fetchone()
        if legacy_row is not None and hmac.compare_digest(
            str(legacy_row[0]), principal_sha256
        ):
            conn.rollback()
            return False, nonce_digest
        cursor = conn.execute(
            f"""
            INSERT OR IGNORE INTO {_CONSUMPTION_TABLE}(
                nonce_digest, principal_sha256, action_digest, expires_at, consumed_at
            ) VALUES (?, ?, ?, ?, ?)
            """,
            (
                nonce_digest,
                principal_sha256,
                action_digest,
                int(expires_at),
                now,
            ),
        )
        consumed = cursor.rowcount == 1
        conn.commit()
        return consumed, nonce_digest
    except (OSError, sqlite3.Error, ValueError):
        if conn is not None:
            conn.rollback()
        raise HTTPException(
            status_code=503,
            detail="action replay protection is unavailable",
        )
    finally:
        if conn is not None:
            conn.close()


def _canonical_json(value: Any) -> str:
    try:
        return json.dumps(
            value,
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=False,
            allow_nan=False,
        )
    except (TypeError, ValueError) as exc:
        raise ValueError("deferred action payload is not canonical JSON") from exc


def _deferred_unsigned(capability: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "version": str(capability.get("version") or ""),
        "capability_id": str(capability.get("capability_id") or ""),
        "principal_id": str(capability.get("principal_id") or ""),
        "task": str(capability.get("task") or ""),
        "args_digest": str(capability.get("args_digest") or ""),
        "issued_at": int(capability.get("issued_at") or 0),
        "expires_at": int(capability.get("expires_at") or 0),
        "max_runs": int(capability.get("max_runs") or 0),
        "parent_action_digest": str(capability.get("parent_action_digest") or ""),
    }


def _deferred_signature(unsigned: Mapping[str, Any], secret: str) -> str:
    if len(str(secret or "").encode("utf-8")) < 32:
        return ""
    return hmac.new(
        str(secret).encode("utf-8"),
        _canonical_json(dict(unsigned)).encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def mint_deferred_action_capability(
    authorization: ActionAuthorization,
    *,
    task: str,
    args: list[Any],
    secret: str,
    ttl_seconds: int,
    max_runs: int,
    now: Optional[int] = None,
) -> dict[str, Any]:
    """Delegate one exact task to a bounded future sink."""

    assert_action_authorized(authorization)
    normalized_task = _bounded_text(task, "deferred task")
    ttl = int(ttl_seconds)
    runs = int(max_runs)
    if ttl < 1 or ttl > _MAX_DEFERRED_TTL_SECONDS:
        raise ValueError("deferred action ttl is outside the bounded range")
    if runs < 1 or runs > _MAX_DEFERRED_RUNS:
        raise ValueError("deferred action max_runs is outside the bounded range")
    issued_at = int(time.time() if now is None else now)
    unsigned = {
        "version": _DEFERRED_VERSION,
        # token_urlsafe may begin with "-" or "_", while opaque identifiers
        # intentionally require an alphanumeric first byte. Prefix the random
        # value so every capability we mint also passes our own verifier.
        "capability_id": f"cap_{secrets.token_urlsafe(24)}",
        "principal_id": authorization.principal_id,
        "task": normalized_task,
        "args_digest": f"sha256:{hashlib.sha256(_canonical_json(list(args or [])).encode('utf-8')).hexdigest()}",
        "issued_at": issued_at,
        "expires_at": issued_at + ttl,
        "max_runs": runs,
        "parent_action_digest": authorization.action_digest,
    }
    signature = _deferred_signature(unsigned, secret)
    if not signature:
        raise ValueError("deferred action signing is not configured")
    return {**unsigned, "signature": signature}


def mint_worker_action_capability(
    authorization: ActionAuthorization,
    *,
    task: str,
    args: list[Any],
    secret: Optional[str] = None,
    db_path: Optional[str | Path] = None,
    ttl_seconds: int = 300,
    now: Optional[int] = None,
) -> dict[str, Any]:
    """Mint one exact proof only when the worker can durably consume it.

    The replay-store check is deliberately part of issuance.  A valid HMAC
    that no worker can consume is not dispatch authority, so publishers must
    fail before they contact the broker when either half of the worker
    contract is unavailable.
    """

    assert_action_authorized(authorization)
    signing_secret, _replay_path = deferred_action_runtime_configuration(
        secret=secret,
        db_path=db_path,
    )

    issued_at = int(time.time() if now is None else now)
    remaining = int(authorization.expires_at) - issued_at
    if remaining < 1:
        raise ValueError("worker action authorization has expired")
    bounded_ttl = min(max(1, int(ttl_seconds)), remaining)
    return mint_deferred_action_capability(
        authorization,
        task=task,
        args=args,
        secret=signing_secret,
        ttl_seconds=bounded_ttl,
        max_runs=1,
        now=issued_at,
    )


def deferred_action_runtime_configuration(
    *,
    secret: Optional[str] = None,
    db_path: Optional[str | Path] = None,
) -> tuple[str, Path]:
    """Return validated signing/replay configuration shared with workers."""

    signing_secret = str(
        secret
        if secret is not None
        else os.getenv("CORTEX_ACTION_DELEGATION_SECRET", "")
    )
    if len(signing_secret.encode("utf-8")) < 32:
        raise ValueError("worker action capability signing is not configured")
    raw_path = str(
        db_path
        if db_path is not None
        else os.getenv(
            "CORTEX_ACTION_CAPABILITY_DB_PATH",
            str(DEFAULT_ACTION_CAPABILITY_DB_PATH),
        )
    ).strip()
    replay_path = Path(raw_path)
    if not raw_path or not replay_path.is_absolute():
        raise ValueError("worker action capability replay protection is unavailable")
    return signing_secret, replay_path


def _validate_deferred_action(
    capability: Mapping[str, Any],
    *,
    task: str,
    args: list[Any],
    secret: str,
    now: Optional[int] = None,
) -> tuple[Optional[dict[str, Any]], str]:
    try:
        unsigned = _deferred_unsigned(capability)
        signature = str(capability.get("signature") or "")
        expected = _deferred_signature(unsigned, secret)
        current = int(time.time() if now is None else now)
        if unsigned["version"] != _DEFERRED_VERSION:
            return None, "unsupported_version"
        _bounded_text(unsigned["capability_id"], "deferred capability id")
        _bounded_text(unsigned["task"], "deferred task")
        if not unsigned["principal_id"] or len(unsigned["principal_id"]) > 2048:
            return None, "invalid_principal"
        if unsigned["task"] != str(task or "").strip():
            return None, "task_mismatch"
        args_digest = f"sha256:{hashlib.sha256(_canonical_json(list(args or [])).encode('utf-8')).hexdigest()}"
        if not hmac.compare_digest(unsigned["args_digest"], args_digest):
            return None, "args_mismatch"
        if not signature or not expected or not hmac.compare_digest(signature, expected):
            return None, "invalid_signature"
        if unsigned["issued_at"] > current + _CLOCK_SKEW_SECONDS:
            return None, "future_issued"
        if unsigned["expires_at"] <= current:
            return None, "expired"
        if unsigned["expires_at"] > unsigned["issued_at"] + _MAX_DEFERRED_TTL_SECONDS:
            return None, "overlong"
        if not 1 <= unsigned["max_runs"] <= _MAX_DEFERRED_RUNS:
            return None, "invalid_max_runs"
        return unsigned, "valid"
    except (TypeError, ValueError):
        return None, "malformed"


def consume_deferred_action_capability(
    capability: Mapping[str, Any],
    *,
    task: str,
    args: list[Any],
    secret: Optional[str] = None,
    db_path: Optional[str | Path] = None,
    now: Optional[int] = None,
) -> dict[str, Any]:
    """Revalidate and durably consume one authorized deferred run."""

    signing_secret = str(
        secret if secret is not None else os.getenv("CORTEX_ACTION_DELEGATION_SECRET", "")
    )
    unsigned, reason = _validate_deferred_action(
        capability,
        task=task,
        args=args,
        secret=signing_secret,
        now=now,
    )
    if unsigned is None:
        return {"consumed": False, "reason": reason}
    raw_path = str(
        db_path
        if db_path is not None
        else os.getenv(
            "CORTEX_ACTION_CAPABILITY_DB_PATH",
            str(DEFAULT_ACTION_CAPABILITY_DB_PATH),
        )
    ).strip()
    if not raw_path:
        return {"consumed": False, "reason": "replay_store_unavailable"}
    path = Path(raw_path)
    if not path.is_absolute():
        return {"consumed": False, "reason": "replay_store_unavailable"}
    path.parent.mkdir(parents=True, exist_ok=True)
    conn: Optional[sqlite3.Connection] = None
    try:
        conn = sqlite3.connect(str(path), timeout=2.5)
        conn.execute("PRAGMA busy_timeout=2500")
        conn.execute("BEGIN IMMEDIATE")
        conn.execute(
            f"""
            CREATE TABLE IF NOT EXISTS {_DEFERRED_TABLE} (
                capability_id TEXT PRIMARY KEY,
                signature_sha256 TEXT NOT NULL,
                runs INTEGER NOT NULL,
                cancelled INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            )
            """
        )
        row = conn.execute(
            f"SELECT signature_sha256, runs, cancelled FROM {_DEFERRED_TABLE} WHERE capability_id = ?",
            (unsigned["capability_id"],),
        ).fetchone()
        signature_digest = hashlib.sha256(str(capability.get("signature") or "").encode("utf-8")).hexdigest()
        if row is None:
            runs = 0
            cancelled = 0
            conn.execute(
                f"INSERT INTO {_DEFERRED_TABLE}(capability_id, signature_sha256, runs, cancelled, updated_at) VALUES (?, ?, 0, 0, ?)",
                (unsigned["capability_id"], signature_digest, int(time.time())),
            )
        else:
            stored_signature, runs, cancelled = row
            if not hmac.compare_digest(str(stored_signature), signature_digest):
                conn.rollback()
                return {"consumed": False, "reason": "capability_id_collision"}
        if bool(cancelled):
            conn.rollback()
            return {"consumed": False, "reason": "cancelled"}
        if int(runs) >= unsigned["max_runs"]:
            conn.rollback()
            return {"consumed": False, "reason": "max_runs_exhausted"}
        next_run = int(runs) + 1
        conn.execute(
            f"UPDATE {_DEFERRED_TABLE} SET runs = ?, updated_at = ? WHERE capability_id = ?",
            (next_run, int(time.time()), unsigned["capability_id"]),
        )
        conn.commit()
        return {
            "consumed": True,
            "reason": "consumed",
            "run": next_run,
            "max_runs": unsigned["max_runs"],
            "principal_id": unsigned["principal_id"],
            "action_digest": unsigned["args_digest"],
            "expires_at": unsigned["expires_at"],
            "capability_id": unsigned["capability_id"],
        }
    except (OSError, sqlite3.Error, ValueError):
        if conn is not None:
            conn.rollback()
        return {"consumed": False, "reason": "replay_store_unavailable"}
    finally:
        if conn is not None:
            conn.close()


def cancel_deferred_action_capability(
    capability: Mapping[str, Any],
    *,
    principal_id: str,
    db_path: str | Path,
    secret: Optional[str] = None,
) -> bool:
    """Cancel an authentic delegated capability, only for its bound principal."""

    try:
        unsigned = _deferred_unsigned(capability)
    except (TypeError, ValueError):
        return False
    signing_secret = str(
        secret if secret is not None else os.getenv("CORTEX_ACTION_DELEGATION_SECRET", "")
    )
    owner = deferred_action_owner(capability, secret=signing_secret)
    if owner is None or not principal_id or not hmac.compare_digest(owner, principal_id):
        return False
    path = Path(db_path)
    if not path.is_absolute():
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    signature_digest = hashlib.sha256(str(capability.get("signature") or "").encode("utf-8")).hexdigest()
    try:
        with sqlite3.connect(str(path), timeout=2.5) as conn:
            conn.execute("BEGIN IMMEDIATE")
            conn.execute(
                f"""
                CREATE TABLE IF NOT EXISTS {_DEFERRED_TABLE} (
                    capability_id TEXT PRIMARY KEY,
                    signature_sha256 TEXT NOT NULL,
                    runs INTEGER NOT NULL,
                    cancelled INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                )
                """
            )
            row = conn.execute(
                f"SELECT signature_sha256 FROM {_DEFERRED_TABLE} WHERE capability_id = ?",
                (unsigned["capability_id"],),
            ).fetchone()
            if row is not None and not hmac.compare_digest(str(row[0]), signature_digest):
                conn.rollback()
                return False
            if row is None:
                conn.execute(
                    f"""
                    INSERT INTO {_DEFERRED_TABLE}(
                        capability_id, signature_sha256, runs, cancelled, updated_at
                    ) VALUES (?, ?, 0, 1, ?)
                    """,
                    (unsigned["capability_id"], signature_digest, int(time.time())),
                )
            else:
                conn.execute(
                    f"UPDATE {_DEFERRED_TABLE} SET cancelled = 1, updated_at = ? "
                    "WHERE capability_id = ?",
                    (int(time.time()), unsigned["capability_id"]),
                )
        return True
    except (OSError, sqlite3.Error):
        return False


def authorize_deferred_action(
    capability: Mapping[str, Any],
    *,
    task: str,
    args: list[Any],
    secret: Optional[str] = None,
    db_path: Optional[str | Path] = None,
) -> Optional[ActionAuthorization]:
    """Turn a consumed delegated run into the same opaque sink receipt."""

    result = consume_deferred_action_capability(
        capability,
        task=task,
        args=args,
        secret=secret,
        db_path=db_path,
    )
    if not result.get("consumed"):
        return None
    capability_id = str(result.get("capability_id") or "")
    return ActionAuthorization(
        principal_id=str(result.get("principal_id") or ""),
        action_digest=str(result.get("action_digest") or ""),
        method="DEFERRED",
        path=str(task or ""),
        body_sha256=str(result.get("action_digest") or "").removeprefix("sha256:"),
        canonical_body_sha256=str(result.get("action_digest") or "").removeprefix("sha256:"),
        nonce_digest=hashlib.sha256(capability_id.encode("utf-8")).hexdigest(),
        expires_at=int(result.get("expires_at") or 0),
        scope="external_action",
        _json_field_digests=(),
        _seal=_AUTHORIZATION_SEAL,
    )


def _credential_secret(request: Request, principal: Any) -> str:
    credential_id = str(getattr(principal, "credential_id", "") or "")
    credentials = getattr(request.app.state, "action_capability_credentials", {})
    secret = str(credentials.get(credential_id, "") if isinstance(credentials, Mapping) else "")
    if len(secret.encode("utf-8")) < 16:
        raise HTTPException(
            status_code=503,
            detail="action capability authorization is not configured",
        )
    return secret


async def require_action_capability(request: Request) -> ActionAuthorization:
    """Verify and atomically consume the exact request's action capability."""

    if bool(getattr(request.app.state, "external_action_kill_switch", False)):
        raise HTTPException(status_code=503, detail="external actions are disabled")
    principal = getattr(request.state, "cortex_principal", None)
    if principal is None:
        raise HTTPException(status_code=403, detail="authenticated action principal required")
    try:
        principal_id, _values = _principal_values(principal)
    except ValueError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc

    role = str(getattr(principal, "role", "") or "")
    credential_id = str(getattr(principal, "credential_id", "") or "")
    global_admin = role == "admin" and credential_id == "cortex-admin"
    action_policies = getattr(request.app.state, "action_capability_policies", {})
    rules = action_policies.get(credential_id, ()) if isinstance(action_policies, Mapping) else ()
    if not global_admin and not action_policy_allows(
        rules,
        method=request.method,
        path=request.url.path,
    ):
        raise HTTPException(
            status_code=403,
            detail="principal is not authorized for this action",
        )

    nonce = str(request.headers.get(ACTION_HEADERS["nonce"], "") or "").strip()
    signature = str(request.headers.get(ACTION_HEADERS["signature"], "") or "").strip()
    try:
        issued_at = int(str(request.headers.get(ACTION_HEADERS["issued_at"], "") or ""))
        expires_at = int(str(request.headers.get(ACTION_HEADERS["expires_at"], "") or ""))
    except ValueError as exc:
        raise HTTPException(status_code=403, detail="complete action capability required") from exc
    now = int(time.time())
    if issued_at > now + _CLOCK_SKEW_SECONDS or issued_at < now - _MAX_TTL_SECONDS:
        raise HTTPException(status_code=403, detail="action capability issue time is invalid")
    if expires_at <= now or expires_at > issued_at + _MAX_TTL_SECONDS:
        raise HTTPException(status_code=403, detail="action capability is expired or overlong")
    try:
        body = await request.body()
        expected = action_signature(
            secret=_credential_secret(request, principal),
            principal=principal,
            method=request.method,
            path=request.url.path,
            body=body,
            nonce=nonce,
            issued_at=issued_at,
            expires_at=expires_at,
        )
    except ValueError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    if not signature or not expected or not hmac.compare_digest(signature, expected):
        raise HTTPException(status_code=403, detail="invalid action capability")

    action_digest = f"sha256:{hashlib.sha256(canonical_action_message(principal=principal, method=request.method, path=request.url.path, body=body, nonce=nonce, issued_at=issued_at, expires_at=expires_at)).hexdigest()}"
    raw_db_path = str(
        getattr(request.app.state, "action_capability_db_path", "")
        or os.getenv("CORTEX_ACTION_CAPABILITY_DB_PATH", "")
    ).strip()
    if not raw_db_path:
        raise HTTPException(status_code=503, detail="action replay protection is not configured")
    consumed, nonce_digest = _consume_nonce(
        db_path=Path(raw_db_path),
        nonce=nonce,
        principal_id=principal_id,
        action_digest=action_digest,
        expires_at=expires_at,
    )
    if not consumed:
        raise HTTPException(status_code=409, detail="action capability was already consumed")
    return ActionAuthorization(
        principal_id=principal_id,
        action_digest=action_digest,
        method=str(request.method or "").upper(),
        path=str(request.url.path or ""),
        body_sha256=body_sha256(body),
        canonical_body_sha256=_canonical_body_sha256(body),
        nonce_digest=nonce_digest,
        expires_at=expires_at,
        scope="external_action",
        _json_field_digests=_json_field_digests(body),
        _seal=_AUTHORIZATION_SEAL,
    )


async def require_action_capability_unless_dry_run(request: Request) -> ActionAuthorization:
    """Preserve truly side-effect-free dry runs without minting authority."""

    try:
        payload = json.loads((await request.body()).decode("utf-8") or "{}")
    except (UnicodeDecodeError, json.JSONDecodeError):
        payload = {}
    if isinstance(payload, dict) and payload.get("dry_run") is True:
        return ActionAuthorization(
            principal_id="dry-run",
            action_digest="",
            method=str(request.method or "").upper(),
            path=str(request.url.path or ""),
            body_sha256=body_sha256(await request.body()),
            canonical_body_sha256=_canonical_body_sha256(await request.body()),
            nonce_digest="",
            expires_at=0,
            scope="dry_run",
            _json_field_digests=_json_field_digests(await request.body()),
            _seal=_AUTHORIZATION_SEAL,
        )
    return await require_action_capability(request)


def assert_action_authorized(
    authorization: Optional[ActionAuthorization],
    *,
    allow_dry_run: bool = False,
    expected_method: Optional[str] = None,
    expected_path: Optional[str] = None,
    expected_body_sha256: Optional[str] = None,
) -> None:
    """Fail closed if a sink is reached without a verifier-created receipt."""

    if not isinstance(authorization, ActionAuthorization):
        raise HTTPException(status_code=403, detail="trusted action authorization required")
    valid_scope = authorization.scope == "external_action" or (
        allow_dry_run and authorization.scope == "dry_run"
    )
    if authorization._seal is not _AUTHORIZATION_SEAL or not valid_scope:
        raise HTTPException(status_code=403, detail="trusted action authorization required")
    if (
        authorization.scope == "external_action"
        and int(authorization.expires_at) <= int(time.time())
    ):
        raise HTTPException(status_code=403, detail="action authorization has expired")
    if expected_method is not None and not hmac.compare_digest(
        authorization.method, str(expected_method).strip().upper()
    ):
        raise HTTPException(status_code=403, detail="action authorization method mismatch")
    if expected_path is not None and not hmac.compare_digest(
        authorization.path, str(expected_path).strip()
    ):
        raise HTTPException(status_code=403, detail="action authorization sink mismatch")
    if expected_body_sha256 is not None and not hmac.compare_digest(
        authorization.body_sha256,
        str(expected_body_sha256).strip().lower().removeprefix("sha256:"),
    ):
        raise HTTPException(status_code=403, detail="action authorization payload mismatch")


def action_authorization_is_global_admin(
    authorization: Optional[ActionAuthorization],
) -> bool:
    """Identify the verifier-sealed global administrator action principal."""

    assert_action_authorized(authorization)
    return bool(
        authorization
        and authorization.principal_id.startswith("role:admin|credential:cortex-admin|")
    )


def action_authorization_json_field_sha256(
    authorization: Optional[ActionAuthorization],
    field_name: str,
) -> Optional[str]:
    """Read a verifier-sealed top-level JSON field digest without raw payload."""

    assert_action_authorized(authorization, allow_dry_run=True)
    expected = str(field_name)
    for key, digest in authorization._json_field_digests:
        if hmac.compare_digest(key, expected):
            return digest
    return None


def assert_action_json_payload(
    authorization: Optional[ActionAuthorization],
    payload: Any,
) -> None:
    """Require the exact canonical JSON payload consumed by the verifier."""

    assert_action_authorized(authorization)
    try:
        expected = canonical_json_sha256(payload)
    except (TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=403,
            detail="action authorization payload mismatch",
        ) from exc
    if not hmac.compare_digest(authorization.canonical_body_sha256, expected):
        raise HTTPException(
            status_code=403,
            detail="action authorization payload mismatch",
        )


def assert_global_admin_authorized(
    authorization: Optional[ActionAuthorization],
) -> None:
    """Require a current action receipt issued for the global administrator."""

    if not action_authorization_is_global_admin(authorization):
        raise HTTPException(status_code=403, detail="global administrator action required")


def deferred_action_owner(
    capability: Mapping[str, Any],
    *,
    secret: str,
) -> Optional[str]:
    """Return the HMAC-authenticated owner of a stored deferred capability."""

    try:
        unsigned = _deferred_unsigned(capability)
        signature = str(capability.get("signature") or "")
        expected = _deferred_signature(unsigned, secret)
        if unsigned["version"] != _DEFERRED_VERSION:
            return None
        _bounded_text(unsigned["capability_id"], "deferred capability id")
        if not unsigned["principal_id"] or len(unsigned["principal_id"]) > 2048:
            return None
        if not signature or not expected or not hmac.compare_digest(signature, expected):
            return None
        return str(unsigned["principal_id"])
    except (TypeError, ValueError):
        return None


__all__ = [
    "ACTION_CAPABILITY_VERSION",
    "ACTION_HEADERS",
    "ActionAuthorization",
    "action_capability_headers",
    "action_authorization_is_global_admin",
    "action_policy_allows",
    "action_signature",
    "authorize_deferred_action",
    "assert_action_authorized",
    "body_sha256",
    "canonical_action_message",
    "cancel_deferred_action_capability",
    "consume_deferred_action_capability",
    "deferred_action_owner",
    "mint_deferred_action_capability",
    "normalize_action_policy_rules",
    "require_action_capability",
    "require_action_capability_unless_dry_run",
    "assert_global_admin_authorized",
]
