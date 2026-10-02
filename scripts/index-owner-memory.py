#!/usr/bin/env python3
"""Refresh an explicit, owner-principal, non-PHI file allowlist.

The receipt is evidence only after both an exact scoped record read and a
non-degraded scoped semantic search return the newly stored record.  A 200 with
no matching result, lexical-only recall, a 403, or unfinished work is degraded.

Project PHI is intentionally blocked.  Supporting it requires a separate,
BAA-approved storage/model route with minimum-necessary retrieval, per-client
authorization, auditing, retention, and deletion controls; this indexer and the
current non-BAA OpenClaw/model path do not provide that architecture.
"""
from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import datetime, timezone
import fcntl
import hashlib
import hmac
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import sys
from typing import Any, Callable, Iterable, Mapping
import urllib.error
import urllib.parse
import urllib.request
import uuid


CONFIG = Path("/root/.openclaw/openclaw.json")
ROOT = Path("/root/clawd")
MANIFEST = Path("/var/lib/cortex/owner-file-sources.json")
RECEIPT = Path(
    os.getenv(
        "CORTEX_OWNER_MEMORY_RECEIPT_PATH",
        "/var/lib/cortex/owner-file-index-20260927.json",
    )
)
LOCK = Path(
    os.getenv(
        "CORTEX_OWNER_MEMORY_RECEIPT_LOCK_PATH",
        "/var/lib/cortex/owner-file-index.lock",
    )
)

POLICY_SCHEMA = "cortex.owner-file-source-policy.v1"
RECEIPT_SCHEMA = "cortex.owner-file-index.v3"
PREVIOUS_RECEIPT_SCHEMA = "cortex.owner-file-index.v2"
LEGACY_RECEIPT_SCHEMA = "cortex.owner-file-index.v1"
AUTHORIZATION_BOUNDARY = "owner_principal_non_phi"
MAX_SOURCES = 256
MAX_SOURCE_BYTES = 2 * 1024 * 1024
MAX_TOTAL_SOURCE_BYTES = 8 * 1024 * 1024
MAX_CHUNKS = 1024
MAX_CHUNK_CHARS = 1800
MAX_RESPONSE_BYTES = 2 * 1024 * 1024
MAX_RETIRED_RECEIPTS = 2048
ALLOWED_KINDS = frozenset({"curated", "daily", "project"})
ALLOWED_SUFFIXES = frozenset({".md", ".txt"})
FORBIDDEN_PATH_PARTS = frozenset({"client", "clients", "patient", "patients", "phi"})
SEMANTIC_MODES = frozenset({"semantic", "semantic_hybrid"})
SEMANTIC_VERIFY_RESULTS = 100
MEMORY_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$")
PRIVACY_BLOCKER = (
    "Project PHI requires a separate BAA-approved, per-client, minimum-necessary "
    "retrieval architecture; it is not authorized for this non-PHI owner index."
)


class IndexingFailure(RuntimeError):
    """The refresh cannot be represented as current."""

    def __init__(self, message: str, *, code: str = "indexing_failed") -> None:
        super().__init__(message)
        self.code = code


class AuthorizationBoundaryError(IndexingFailure):
    """The request would cross the signed owner/non-PHI boundary."""

    def __init__(self, message: str) -> None:
        super().__init__(message, code="authorization_boundary")


class ReceiptError(IndexingFailure):
    def __init__(self, message: str) -> None:
        super().__init__(message, code="receipt_invalid")


class BackendError(IndexingFailure):
    pass


class _RejectRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Never forward owner write credentials beyond the configured origin."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise BackendError(
            "Cortex redirected an owner-memory request",
            code="backend_redirect_refused",
        )


@dataclass(frozen=True)
class SourcePolicy:
    path: str
    kind: str
    classification: str


@dataclass(frozen=True)
class DesiredChunk:
    fact_key: str
    legacy_fact_key: str
    source_id: str
    chunk_id: str
    path: str
    kind: str
    ordinal: int
    duplicate_index: int
    text: str
    sha256: str
    source_sha256: str


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def digest(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def digest_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def canonical_digest(value: Any) -> str:
    return digest(json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False))


def stable_source_id(scope_digest: str, source_path: str) -> str:
    return "src_" + digest(
        "cortex.owner-source.v1\0" + str(scope_digest) + "\0" + str(source_path)
    )[:48]


def stable_chunk_id(source_id: str, text: str, duplicate_index: int = 0) -> str:
    return "chk_" + digest(
        "cortex.owner-chunk.v1\0"
        + str(source_id)
        + "\0"
        + digest(text)
        + "\0"
        + str(int(duplicate_index))
    )[:48]


def _principal_storage_workspace(scope: Mapping[str, str]) -> str:
    principal_fields = (
        "tenant_id", "workspace_id", "agent_id", "user_id", "channel_id", "session_id",
    )
    canonical_principal = "\0".join(str(scope[field]) for field in principal_fields)
    return (
        "principal-" + hashlib.sha256(canonical_principal.encode("utf-8")).hexdigest()[:48]
    )


def _l22_candidate_id(scope: Mapping[str, str], idempotency_key: str) -> str:
    return str(uuid.uuid5(
        uuid.NAMESPACE_URL,
        (
            f"cortex:l22:{scope['tenant_id']}:"
            f"{_principal_storage_workspace(scope)}:{idempotency_key}"
        ),
    ))


def _candidate_identity(
    scope: Mapping[str, str],
    entry: DesiredChunk,
    predecessor_id: str,
    generation: int,
) -> tuple[str, str]:
    """Match L22's principal-local deterministic idempotency identity."""

    idempotency_key = "owner-file-index-v2:" + canonical_digest({
        "factKey": entry.fact_key,
        # L22 binds an idempotency key to the entire store request. The V3
        # payload intentionally contains only stable source/content provenance;
        # file revision and ordinal remain receipt diagnostics, not identity.
        "storePayloadSha256": _entry_store_digest(entry),
        # Content can legitimately revert. Binding the prior generation avoids
        # replaying a deterministic ID that was already superseded.
        "predecessorId": str(predecessor_id or ""),
        "generation": int(generation),
    })
    return idempotency_key, _l22_candidate_id(scope, idempotency_key)


def chunks(source: Path) -> Iterable[str]:
    """Compatibility helper used by operators and tests."""
    yield from chunks_from_text(source.read_text(encoding="utf-8"))


def chunks_from_text(text: str) -> Iterable[str]:
    # Semantic blocks are independent content-addressed units. Greedy packing
    # of adjacent paragraphs makes an ordinary earlier insertion shift every
    # later packing boundary, replacing IDs for bytes that did not change.
    # Markdown headings and list items are boundaries too because owner memory
    # is commonly maintained as consecutive bullets without blank lines.
    normalized = str(text or "").replace("\r\n", "\n").replace("\r", "\n")
    blocks: list[str] = []
    current: list[str] = []

    def flush() -> None:
        if current:
            block = "\n".join(current).strip()
            if block:
                blocks.append(block)
            current.clear()

    boundary = re.compile(r"^(?:#{1,6}[ \t]+|[-+*][ \t]+|\d{1,6}[.)][ \t]+)")
    for line in normalized.split("\n"):
        if not line.strip():
            flush()
            continue
        if boundary.match(line) and current:
            flush()
        current.append(line.rstrip())
    flush()

    for paragraph in blocks:
        paragraph = paragraph.strip()
        if not paragraph:
            continue
        while len(paragraph) > MAX_CHUNK_CHARS:
            yield paragraph[:MAX_CHUNK_CHARS]
            paragraph = paragraph[MAX_CHUNK_CHARS:]
        if paragraph:
            yield paragraph


def _require_nonempty_string(mapping: Mapping[str, Any], field: str) -> str:
    value = mapping.get(field)
    if not isinstance(value, str) or not value:
        raise AuthorizationBoundaryError(f"trusted configuration field is missing: {field}")
    return value


def signed_scope(config: dict[str, Any]) -> tuple[dict[str, Any], dict[str, str], str]:
    try:
        plugin = config["plugins"]["entries"]["cortex-memory-bridge"]["config"]
        route = config["plugins"]["entries"]["cortex-route-gate"]["config"]
        allowed = config["channels"]["whatsapp"]["allowFrom"]
    except (KeyError, TypeError) as exc:
        raise AuthorizationBoundaryError("trusted owner configuration is incomplete") from exc
    if not isinstance(plugin, dict) or not isinstance(route, dict):
        raise AuthorizationBoundaryError("trusted plugin configuration is invalid")
    if not isinstance(allowed, list) or len(allowed) != 1 or not isinstance(allowed[0], str):
        raise AuthorizationBoundaryError("owner allowFrom must contain exactly one sender")
    owner_sender = allowed[0]
    if plugin.get("ownerSenderId") != owner_sender or route.get("ownerSenderId") != owner_sender:
        raise AuthorizationBoundaryError("route and memory owner bindings do not exactly match allowFrom")
    matched_fields = (
        "tenantId", "workspaceId", "agentId", "userId", "channelId",
        "sessionIdentityHmacSecret", "scopeHmacSecret", "scopeCredentialId",
    )
    for field in matched_fields:
        plugin_value = _require_nonempty_string(plugin, field)
        route_value = _require_nonempty_string(route, field)
        if not hmac.compare_digest(plugin_value, route_value):
            raise AuthorizationBoundaryError(f"route/memory scope mismatch: {field}")
    if plugin["userId"] != "openclaw-owner" or plugin["channelId"] != "whatsapp":
        raise AuthorizationBoundaryError("owner index requires the fixed owner/whatsapp principal")
    _require_nonempty_string(plugin, "writeToken")
    _require_nonempty_string(plugin, "baseUrl")
    session_identity = f"cortex.owner.memory.v1\n{owner_sender}"
    session_id = "openclaw-" + hmac.new(
        plugin["sessionIdentityHmacSecret"].encode("utf-8"),
        session_identity.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    scope = {
        "tenant_id": plugin["tenantId"],
        "workspace_id": plugin["workspaceId"],
        "agent_id": plugin["agentId"],
        "user_id": plugin["userId"],
        "channel_id": plugin["channelId"],
        "session_id": session_id,
    }
    message = "\n".join([
        "cortex.memory.principal.v2", plugin["scopeCredentialId"], *scope.values(),
    ])
    signature = hmac.new(
        plugin["scopeHmacSecret"].encode("utf-8"),
        message.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return plugin, scope, signature


def _read_json(path: Path, *, label: str, required: bool = True) -> dict[str, Any] | None:
    if not path.exists():
        if required:
            raise IndexingFailure(f"{label} is missing", code=f"{label}_missing")
        return None
    try:
        raw = path.read_bytes()
        if len(raw) > MAX_RESPONSE_BYTES:
            raise ValueError("document exceeds immutable size bound")
        value = json.loads(raw)
    except (OSError, UnicodeDecodeError, json.JSONDecodeError, ValueError) as exc:
        raise IndexingFailure(f"{label} is unreadable or invalid", code=f"{label}_invalid") from exc
    if not isinstance(value, dict):
        raise IndexingFailure(f"{label} must be a JSON object", code=f"{label}_invalid")
    return value


def _validate_relative_source(raw_path: Any) -> str:
    if not isinstance(raw_path, str) or not raw_path or "\x00" in raw_path:
        raise AuthorizationBoundaryError("source path must be a non-empty relative string")
    if any(character in raw_path for character in "*?[]{}"):
        raise AuthorizationBoundaryError("source globs are forbidden; approve exact files")
    pure = PurePosixPath(raw_path)
    if pure.is_absolute() or raw_path != pure.as_posix() or any(part in {"", ".", ".."} for part in pure.parts):
        raise AuthorizationBoundaryError("source path must be normalized and root-relative")
    if any(part.casefold() in FORBIDDEN_PATH_PARTS for part in pure.parts):
        raise AuthorizationBoundaryError("client, patient, and PHI trees are outside this index")
    if pure.suffix.casefold() not in ALLOWED_SUFFIXES:
        raise AuthorizationBoundaryError("only explicitly approved Markdown/text owner files are supported")
    return pure.as_posix()


def load_policy(path: Path) -> tuple[list[SourcePolicy], str]:
    raw = _read_json(path, label="source_policy")
    assert raw is not None
    if raw.get("schemaVersion") != POLICY_SCHEMA:
        raise AuthorizationBoundaryError("owner source policy schema is invalid")
    if raw.get("authorizationBoundary") != AUTHORIZATION_BOUNDARY:
        raise AuthorizationBoundaryError("owner source policy does not assert the non-PHI boundary")
    sources = raw.get("sources")
    if not isinstance(sources, list) or len(sources) > MAX_SOURCES:
        raise AuthorizationBoundaryError("owner source policy has an invalid source list")
    normalized: list[SourcePolicy] = []
    seen: set[str] = set()
    for item in sources:
        if not isinstance(item, dict):
            raise AuthorizationBoundaryError("owner source policy entries must be objects")
        path_value = _validate_relative_source(item.get("path"))
        kind = item.get("kind")
        if kind not in ALLOWED_KINDS:
            raise AuthorizationBoundaryError("source kind must be curated, daily, or project")
        if item.get("classification") != "owner_non_phi":
            raise AuthorizationBoundaryError(PRIVACY_BLOCKER)
        if item.get("approved") is not True or item.get("baaRequired") is not False:
            raise AuthorizationBoundaryError(PRIVACY_BLOCKER)
        if item.get("containsPhi") not in (None, False):
            raise AuthorizationBoundaryError(PRIVACY_BLOCKER)
        if path_value in seen:
            raise AuthorizationBoundaryError(f"duplicate approved source: {path_value}")
        seen.add(path_value)
        normalized.append(SourcePolicy(path_value, str(kind), "owner_non_phi"))
    normalized.sort(key=lambda entry: entry.path)
    digest_input = {
        "schemaVersion": POLICY_SCHEMA,
        "authorizationBoundary": AUTHORIZATION_BOUNDARY,
        "sources": [
            {
                "path": entry.path,
                "kind": entry.kind,
                "classification": entry.classification,
                "approved": True,
                "baaRequired": False,
            }
            for entry in normalized
        ],
    }
    return normalized, canonical_digest(digest_input)


def _safe_read_source(root: Path, relative: str) -> bytes | None:
    try:
        root_real = root.resolve(strict=True)
    except OSError as exc:
        raise AuthorizationBoundaryError("approved source root is unavailable") from exc
    if not root_real.is_dir():
        raise AuthorizationBoundaryError("approved source root is not a directory")
    parts = PurePosixPath(relative).parts
    directory_flags = (
        os.O_RDONLY
        | getattr(os, "O_DIRECTORY", 0)
        | getattr(os, "O_CLOEXEC", 0)
        | getattr(os, "O_NOFOLLOW", 0)
    )
    file_flags = (
        os.O_RDONLY
        | getattr(os, "O_CLOEXEC", 0)
        | getattr(os, "O_NOFOLLOW", 0)
        | getattr(os, "O_NONBLOCK", 0)
    )

    def open_component(parent_fd: int, part: str, flags: int, *, directory: bool) -> int | None:
        try:
            return os.open(part, flags, dir_fd=parent_fd)
        except FileNotFoundError:
            return None
        except OSError as exc:
            try:
                component = os.stat(part, dir_fd=parent_fd, follow_symlinks=False)
            except FileNotFoundError:
                return None
            except OSError:
                component = None
            if component is not None and stat.S_ISLNK(component.st_mode):
                raise AuthorizationBoundaryError(
                    f"approved source path may not traverse a symlink: {relative}"
                ) from exc
            if directory and component is not None and not stat.S_ISDIR(component.st_mode):
                raise AuthorizationBoundaryError(
                    f"approved source path has a non-directory component: {relative}"
                ) from exc
            raise IndexingFailure(
                f"approved source cannot be opened: {relative}",
                code="source_unreadable",
            ) from exc

    root_fd = -1
    cursor_fd = -1
    fd = -1
    try:
        root_fd = os.open(root_real, directory_flags)
        cursor_fd = root_fd
        for part in parts[:-1]:
            next_fd = open_component(cursor_fd, part, directory_flags, directory=True)
            if next_fd is None:
                return None
            if cursor_fd != root_fd:
                os.close(cursor_fd)
            cursor_fd = next_fd
        opened = open_component(cursor_fd, parts[-1], file_flags, directory=False)
        if opened is None:
            return None
        fd = opened
        file_stat = os.fstat(fd)
        if not stat.S_ISREG(file_stat.st_mode):
            raise AuthorizationBoundaryError(f"approved source is not a regular file: {relative}")
        if file_stat.st_size > MAX_SOURCE_BYTES:
            raise AuthorizationBoundaryError(f"approved source exceeds its size bound: {relative}")
        data = bytearray()
        while len(data) <= MAX_SOURCE_BYTES:
            block = os.read(fd, min(65536, MAX_SOURCE_BYTES + 1 - len(data)))
            if not block:
                break
            data.extend(block)
        if len(data) > MAX_SOURCE_BYTES:
            raise AuthorizationBoundaryError(f"approved source exceeds its size bound: {relative}")
        return bytes(data)
    except AuthorizationBoundaryError:
        raise
    except OSError as exc:
        raise IndexingFailure(
            f"approved source cannot be opened: {relative}",
            code="source_unreadable",
        ) from exc
    finally:
        if fd >= 0:
            os.close(fd)
        if cursor_fd >= 0 and cursor_fd != root_fd:
            os.close(cursor_fd)
        if root_fd >= 0:
            os.close(root_fd)


def collect_desired(
    root: Path, policies: list[SourcePolicy], *, scope_digest: str = "local"
) -> tuple[dict[str, DesiredChunk], dict[str, dict[str, Any]]]:
    desired: dict[str, DesiredChunk] = {}
    source_receipts: dict[str, dict[str, Any]] = {}
    total_source_bytes = 0
    for source in policies:
        raw = _safe_read_source(root, source.path)
        if raw is None:
            source_receipts[source.path] = {
                "state": "deleted",
                "kind": source.kind,
                "classification": source.classification,
                "sourceId": stable_source_id(scope_digest, source.path),
                "chunkCount": 0,
            }
            continue
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise AuthorizationBoundaryError(f"approved source is not UTF-8 text: {source.path}") from exc
        total_source_bytes += len(raw)
        if total_source_bytes > MAX_TOTAL_SOURCE_BYTES:
            raise AuthorizationBoundaryError("approved owner sources exceed the total byte bound")
        source_hash = digest_bytes(raw)
        source_id = stable_source_id(scope_digest, source.path)
        duplicate_counts: dict[str, int] = {}
        count = 0
        for ordinal, chunk_text in enumerate(chunks_from_text(text)):
            chunk_hash = digest(chunk_text)
            duplicate_index = duplicate_counts.get(chunk_hash, 0)
            duplicate_counts[chunk_hash] = duplicate_index + 1
            chunk_id = stable_chunk_id(source_id, chunk_text, duplicate_index)
            fact_key = f"owner-file:{source_id}:{chunk_id}"
            desired[fact_key] = DesiredChunk(
                fact_key=fact_key,
                legacy_fact_key=f"owner-file:{source.path}:{ordinal}",
                source_id=source_id,
                chunk_id=chunk_id,
                path=source.path,
                kind=source.kind,
                ordinal=ordinal,
                duplicate_index=duplicate_index,
                text=chunk_text,
                sha256=chunk_hash,
                source_sha256=source_hash,
            )
            count += 1
            if len(desired) > MAX_CHUNKS:
                raise AuthorizationBoundaryError("approved owner sources exceed the total chunk bound")
        source_receipts[source.path] = {
            "state": "present",
            "kind": source.kind,
            "classification": source.classification,
            "sourceId": source_id,
            "sourceRevision": source_hash,
            "sha256": source_hash,
            "bytes": len(raw),
            "chunkCount": count,
        }
    return desired, source_receipts


def _empty_receipt(scope_digest: str = "", policy_digest: str = "") -> dict[str, Any]:
    return {
        "schemaVersion": RECEIPT_SCHEMA,
        "authorizationBoundary": AUTHORIZATION_BOUNDARY,
        "scopeDigest": scope_digest,
        "policyDigest": policy_digest,
        "accepted": {},
        "sources": {},
        "retired": {},
        "generations": {},
        "pending": [],
        "lastRun": {"status": "never"},
        "health": {"status": "degraded", "reason": "never_verified"},
        "privacyBoundary": PRIVACY_BLOCKER,
    }


def load_receipt(path: Path) -> tuple[dict[str, Any], bool, bool]:
    raw = _read_json(path, label="receipt", required=False)
    if raw is None:
        return _empty_receipt(), False, False
    schema = raw.get("schemaVersion")
    if schema not in {RECEIPT_SCHEMA, PREVIOUS_RECEIPT_SCHEMA, LEGACY_RECEIPT_SCHEMA}:
        raise ReceiptError("owner memory receipt schema is invalid")
    accepted = raw.get("accepted")
    if not isinstance(accepted, dict):
        raise ReceiptError("owner memory receipt accepted map is invalid")
    normalized: dict[str, dict[str, Any]] = {}
    for fact_key, item in accepted.items():
        if not isinstance(fact_key, str) or not fact_key.startswith("owner-file:") or not isinstance(item, dict):
            raise ReceiptError("owner memory receipt contains an invalid accepted entry")
        row_id = item.get("id")
        fingerprint = item.get("sha256")
        if not isinstance(row_id, str) or not MEMORY_ID_RE.fullmatch(row_id):
            raise ReceiptError("owner memory receipt contains an invalid record id")
        if not isinstance(fingerprint, str) or not re.fullmatch(r"[0-9a-f]{64}", fingerprint):
            raise ReceiptError("owner memory receipt contains an invalid chunk digest")
        payload_fingerprint = item.get("storePayloadSha256")
        if payload_fingerprint is not None and (
            not isinstance(payload_fingerprint, str)
            or not re.fullmatch(r"[0-9a-f]{64}", payload_fingerprint)
        ):
            raise ReceiptError("owner memory receipt contains an invalid store payload digest")
        normalized[fact_key] = dict(item)
    if schema == LEGACY_RECEIPT_SCHEMA:
        migrated = _empty_receipt()
        migrated["accepted"] = normalized
        migrated["lastRun"] = {"status": "legacy_migration_required"}
        migrated["health"] = {"status": "degraded", "reason": "legacy_migration_required"}
        return migrated, True, True
    if raw.get("authorizationBoundary") != AUTHORIZATION_BOUNDARY:
        raise ReceiptError("owner memory receipt authorization boundary is invalid")
    if schema == PREVIOUS_RECEIPT_SCHEMA:
        # V2 is already principal-scoped and cryptographically bound.  Preserve
        # it as the predecessor set; apply will store stable V3 identities,
        # verify every exact ID semantically, then retire the ordinal records.
        raw["schemaVersion"] = RECEIPT_SCHEMA
        raw["lastRun"] = {"status": "stable_identity_migration_required"}
        raw["health"] = {
            "status": "degraded",
            "reason": "stable_identity_migration_required",
        }
    raw.setdefault("generations", {})
    for field, expected_type in (("sources", dict), ("retired", dict), ("generations", dict), ("pending", list), ("lastRun", dict), ("health", dict)):
        if not isinstance(raw.get(field), expected_type):
            raise ReceiptError(f"owner memory receipt field is invalid: {field}")
    for fact_key, generation in raw["generations"].items():
        if (
            not isinstance(fact_key, str)
            or not fact_key.startswith("owner-file:")
            or not isinstance(generation, int)
            or isinstance(generation, bool)
            or generation < 1
            or generation >= 2**63
        ):
            raise ReceiptError("owner memory receipt contains an invalid generation")
    raw["accepted"] = normalized
    return raw, True, False


def atomic_write_receipt(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp-{os.getpid()}")
    try:
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(value, handle, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        os.chmod(path, 0o600)
        directory_fd = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    finally:
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass


class HttpMemoryClient:
    def __init__(self, *, plugin: dict[str, Any], scope: dict[str, str], signature: str) -> None:
        parsed = urllib.parse.urlsplit(str(plugin["baseUrl"]))
        if parsed.scheme not in {"http", "https"} or parsed.hostname not in {"127.0.0.1", "localhost", "::1"}:
            raise AuthorizationBoundaryError("owner indexing credentials may only be sent to loopback Cortex")
        if parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise AuthorizationBoundaryError("Cortex base URL is not a safe loopback origin")
        self.base_url = str(plugin["baseUrl"]).rstrip("/")
        self.plugin = plugin
        self.scope = scope
        self.signature = signature
        # urllib's process-wide opener follows redirects and copies ordinary
        # custom headers to the redirected request.  These headers contain the
        # owner write token and signed principal, so this client must never
        # follow even a loopback server's redirect to another origin.
        self.opener = urllib.request.build_opener(
            urllib.request.ProxyHandler({}),
            _RejectRedirectHandler(),
        )
        token_header = str(plugin.get("writeTokenHeader") or "x-cortex-write-token")
        self.headers = {
            "Content-Type": "application/json",
            token_header: str(plugin["writeToken"]),
            **{f"x-cortex-{key.replace('_', '-')}": value for key, value in scope.items()},
            "x-cortex-scope-credential-id": str(plugin["scopeCredentialId"]),
            "x-cortex-scope-signature": signature,
        }

    def _scoped_payload(self, payload: dict[str, Any]) -> dict[str, Any]:
        return {
            **payload,
            "tenant_id": self.scope["tenant_id"],
            "workspace_id": self.scope["workspace_id"],
            "scope": self.scope,
            "scope_credential_id": self.plugin["scopeCredentialId"],
            "scope_signature": self.signature,
        }

    def _post(self, path: str, payload: dict[str, Any], *, missing_ok: bool = False) -> dict[str, Any] | None:
        request = urllib.request.Request(
            self.base_url + path,
            json.dumps(self._scoped_payload(payload), separators=(",", ":")).encode("utf-8"),
            self.headers,
            method="POST",
        )
        try:
            response = self.opener.open(request, timeout=30)
        except urllib.error.HTTPError as exc:
            if missing_ok and exc.code == 404:
                return None
            code = "backend_forbidden" if exc.code in {401, 403} else "backend_http_error"
            raise BackendError(f"Cortex {path} returned HTTP {exc.code}", code=code) from exc
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            raise BackendError(f"Cortex {path} is unavailable", code="backend_unavailable") from exc
        with response:
            status_code = getattr(response, "status", response.getcode())
            if status_code != 200:
                raise BackendError(f"Cortex {path} returned HTTP {status_code}", code="backend_http_error")
            raw = response.read(MAX_RESPONSE_BYTES + 1)
        if len(raw) > MAX_RESPONSE_BYTES:
            raise BackendError(f"Cortex {path} response exceeded its size bound", code="backend_response_invalid")
        try:
            result = json.loads(raw)
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise BackendError(f"Cortex {path} returned invalid JSON", code="backend_response_invalid") from exc
        if not isinstance(result, dict):
            raise BackendError(f"Cortex {path} returned a non-object response", code="backend_response_invalid")
        return result

    def store(
        self,
        text: str,
        metadata: dict[str, Any],
        *,
        idempotency_key: str,
        expected_id: str,
        generation: int,
    ) -> dict[str, Any]:
        result = self._post(
            "/l22/store",
            {
                "content": text,
                "type": "memory",
                "metadata": metadata,
                "idempotency_key": idempotency_key,
                "operation_generation": generation,
            },
        )
        assert result is not None
        if (
            result.get("status") != "stored"
            or result.get("id") != expected_id
            or not MEMORY_ID_RE.fullmatch(expected_id)
        ):
            raise BackendError(
                "Cortex did not confirm the deterministic primary semantic store",
                code="store_not_semantic",
            )
        return result

    def store_status(
        self,
        *,
        idempotency_key: str,
        expected_id: str,
        fact_key: str,
        generation: int,
    ) -> dict[str, Any]:
        result = self._post(
            "/l22/store/status",
            {
                "idempotency_key": idempotency_key,
                "expected_id": expected_id,
                "fact_key": fact_key,
                "operation_generation": generation,
            },
        )
        assert result is not None
        if (
            result.get("id") != expected_id
            or result.get("status") not in {"unknown", "prepared", "committed", "cancelled"}
            or not isinstance(result.get("known"), bool)
        ):
            raise BackendError(
                "Cortex returned an invalid store-operation status",
                code="store_status_invalid",
            )
        return result

    def cancel_store(
        self,
        *,
        idempotency_key: str,
        expected_id: str,
        fact_key: str,
        generation: int,
        reason: str,
    ) -> dict[str, Any]:
        result = self._post(
            "/l22/store/cancel",
            {
                "idempotency_key": idempotency_key,
                "expected_id": expected_id,
                "fact_key": fact_key,
                "operation_generation": generation,
                "reason": reason,
            },
        )
        assert result is not None
        if (
            result.get("id") != expected_id
            or result.get("known") is not True
            or result.get("status") != "cancelled"
            or result.get("visibility_fenced") is not True
            or result.get("projection_status") != "complete"
        ):
            raise BackendError(
                "Cortex did not confirm a converged durable cancellation fence",
                code="store_cancel_incomplete",
            )
        return result

    def read(self, memory_id: str) -> dict[str, Any] | None:
        result = self._post(
            "/librarian/record", {"id": memory_id, "from_line": 1, "lines": 200}, missing_ok=True,
        )
        if result is None:
            return None
        if (
            result.get("id") != memory_id
            or result.get("path") != f"cortex:{memory_id}"
            or result.get("from") != 1
            or not isinstance(result.get("text"), str)
            or not isinstance(result.get("totalLines"), int)
            or result["totalLines"] < 0
            or result["totalLines"] > MAX_CHUNK_CHARS + 1
        ):
            raise BackendError("Cortex exact readback did not match its request", code="record_readback_invalid")
        parts = [result["text"]]
        for from_line in range(201, result["totalLines"] + 1, 200):
            page = self._post(
                "/librarian/record",
                {"id": memory_id, "from_line": from_line, "lines": 200},
            )
            if (
                not isinstance(page, dict)
                or page.get("id") != memory_id
                or page.get("path") != f"cortex:{memory_id}"
                or page.get("from") != from_line
                or page.get("totalLines") != result["totalLines"]
                or not isinstance(page.get("text"), str)
            ):
                raise BackendError("Cortex paged readback did not match its request", code="record_readback_invalid")
            parts.append(page["text"])
        result["text"] = "\n".join(parts)
        return result

    def search(
        self,
        query: str,
        *,
        n_results: int = 12,
        filters: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {"query": query, "n_results": n_results}
        if filters:
            payload["filters"] = dict(filters)
        result = self._post("/knowledge/search", payload)
        assert result is not None
        return result

    def supersede(self, memory_id: str, *, reason: str) -> dict[str, Any]:
        result = self._post("/librarian/supersede", {"memory_ids": [memory_id], "reason": reason})
        assert result is not None
        if result.get("success") is not True or not isinstance(result.get("updated"), int):
            raise BackendError("Cortex did not confirm supersession", code="supersession_invalid")
        return result

    def mark_verified(self, memory_id: str, *, source_revision: str) -> dict[str, Any]:
        result = self._post(
            "/l22/verify",
            {
                "memory_id": memory_id,
                "source_revision": source_revision,
                "evidence": "owner_index_exact_read_plus_semantic_exact_id",
            },
        )
        assert result is not None
        if result.get("id") != memory_id or result.get("source_revision") != source_revision:
            raise BackendError(
                "Cortex did not confirm temporal verification metadata",
                code="verification_metadata_invalid",
            )
        return result


def _entry_metadata(
    entry: DesiredChunk, *, generation: int | None = None
) -> dict[str, Any]:
    metadata = {
        "source": "local_file_memory",
        "path": entry.path,
        "source_kind": entry.kind,
        "source_classification": "owner_non_phi",
        "source_id": entry.source_id,
        "chunk_id": entry.chunk_id,
        # Revision identity is content-local. File-level revision/ordinal data
        # belongs in the operator receipt; embedding it here would replace an
        # unchanged later chunk whenever an earlier paragraph is inserted.
        "source_revision": entry.sha256,
        "content_hash": entry.sha256,
        "fact_key": entry.fact_key,
        "source_sha256": entry.sha256,
        "source_chunk_duplicate_index": entry.duplicate_index,
        "memory_type": "owner_file_chunk",
        "time_precision": "unknown",
        "memory_status": "active",
    }
    if generation is not None:
        metadata["owner_source_generation"] = int(generation)
    return metadata


def _entry_store_digest(entry: DesiredChunk) -> str:
    return canonical_digest({
        "content": entry.text,
        "type": "memory",
        "metadata": _entry_metadata(entry),
    })


def _semantic_query(entry: DesiredChunk) -> str:
    # Keep the source text dominant in embedding space, then append a bounded
    # semantic instruction so the exact-contains shortcut cannot masquerade as
    # vector recall. Exact source/fact filters plus the exact returned ID remain
    # the acceptance authority.
    compact = " ".join(entry.text.split())[:1200]
    return f"{compact} What durable information does this owner memory convey?"


def verify_entry(client: Any, entry: DesiredChunk, memory_id: str) -> None:
    record = client.read(memory_id)
    if not isinstance(record, dict) or record.get("id") != memory_id or record.get("text") != entry.text:
        raise BackendError("exact scoped read-after-write failed", code="exact_readback_failed")
    # Verification must cover the bounded owner collection, not only the first
    # page. A correct new record can rank below twelve older, closely related
    # project chunks even though normal semantic recall is healthy.
    response = client.search(
        _semantic_query(entry),
        n_results=SEMANTIC_VERIFY_RESULTS,
        filters={
            "source_ids": [entry.source_id],
            "fact_keys": [entry.fact_key],
            "statuses": ["active"],
            "include_stale": True,
        },
    )
    results = response.get("results")
    if not isinstance(results, list) or not results:
        raise BackendError("semantic search returned no results", code="semantic_empty")
    mode = str(response.get("search_mode") or response.get("mode") or "").strip().lower()
    if response.get("available") is not True:
        raise BackendError("semantic search did not affirm availability", code="semantic_unavailable")
    if mode not in SEMANTIC_MODES or response.get("degraded") is not False or response.get("warning") not in (None, ""):
        raise BackendError("semantic search was degraded or partial", code="semantic_partial")
    match = next((row for row in results if isinstance(row, dict) and row.get("id") == memory_id), None)
    if match is None:
        raise BackendError(
            "semantic search omitted the exact chunk identity",
            code="semantic_exact_chunk_missing",
        )
    metadata = match.get("metadata")
    # Exact readback above already verifies the complete stored text and full
    # source metadata. Semantic search enriches/normalizes metadata with score
    # and principal fields, so require only stable source identity here.
    semantic_identity = {
        "source": "local_file_memory",
        "path": entry.path,
        "source_id": entry.source_id,
        "chunk_id": entry.chunk_id,
        "source_revision": entry.sha256,
        "fact_key": entry.fact_key,
        "memory_status": "active",
    }
    semantic_text = str(match.get("text") or "")
    # The search projection trims boundary whitespace before embedding/result
    # rendering. Exact readback above remains byte-exact; semantic comparison
    # normalizes boundary whitespace only and preserves all interior content.
    semantic_text_matches = semantic_text.strip() == entry.text.strip()
    if (
        not semantic_text_matches
        or not isinstance(metadata, dict)
        or any(metadata.get(key) != value for key, value in semantic_identity.items())
    ):
        raise BackendError("semantic result identity/text did not match the exact source readback", code="semantic_result_mismatch")
    marker = getattr(client, "mark_verified", None)
    if callable(marker):
        marker(memory_id, source_revision=entry.sha256)


def retire_record(client: Any, memory_id: str, *, reason: str) -> None:
    response = client.supersede(memory_id, reason=reason)
    ids = response.get("ids") if isinstance(response.get("ids"), list) else []
    missing = response.get("missing") if isinstance(response.get("missing"), list) else []
    if memory_id not in ids and memory_id not in missing:
        raise BackendError("supersession response omitted the requested record", code="supersession_partial")
    if client.read(memory_id) is not None:
        raise BackendError("stale record remained active after supersession", code="stale_record_active")


def retire_accepted_record(
    client: Any,
    fact_key: str,
    accepted: Mapping[str, Any],
    *,
    reason: str,
) -> None:
    memory_id = str(accepted.get("id") or "")
    idempotency_key = accepted.get("idempotencyKey")
    generation = accepted.get("generation")
    if idempotency_key and isinstance(generation, int) and not isinstance(generation, bool):
        client.cancel_store(
            idempotency_key=str(idempotency_key),
            expected_id=memory_id,
            fact_key=fact_key,
            generation=generation,
            reason=reason,
        )
        if client.read(memory_id) is not None:
            raise BackendError(
                "cancelled accepted record remained visible",
                code="store_cancel_visibility_failed",
            )
        return
    # Wave3 receipts lack the operation identity. Preserve the safe historical
    # path, but do not pretend a missing row is a pre-arrival cancellation.
    retire_record(client, memory_id, reason=reason)


def _accepted_row(
    entry: DesiredChunk,
    memory_id: str,
    verified_at: str,
    *,
    idempotency_key: str | None = None,
    generation: int | None = None,
) -> dict[str, Any]:
    row = {
        "id": memory_id,
        "sha256": entry.sha256,
        "sourceSha256": entry.sha256,
        "sourceFileSha256": entry.source_sha256,
        "storePayloadSha256": _entry_store_digest(entry),
        "path": entry.path,
        "sourceId": entry.source_id,
        "chunkId": entry.chunk_id,
        "sourceRevision": entry.sha256,
        "legacyFactKey": entry.legacy_fact_key,
        "ordinal": entry.ordinal,
        "kind": entry.kind,
        "memoryStatus": "active",
        "semanticVerified": True,
        "verifiedAt": verified_at,
    }
    if idempotency_key:
        row["idempotencyKey"] = idempotency_key
    if generation is not None:
        row["generation"] = int(generation)
    return row


def _trim_retired(retired: dict[str, Any]) -> dict[str, Any]:
    if len(retired) <= MAX_RETIRED_RECEIPTS:
        return retired
    ordered = sorted(retired.items(), key=lambda item: str((item[1] or {}).get("retiredAt") or ""))
    return dict(ordered[-MAX_RETIRED_RECEIPTS:])


def _plan(
    receipt: dict[str, Any],
    desired: dict[str, DesiredChunk],
    *,
    repair_keys: Iterable[str] = (),
) -> tuple[list[str], list[str], list[str], list[str]]:
    accepted = receipt["accepted"]
    new = sorted(key for key in desired if key not in accepted)
    changed = sorted(
        key for key in desired
        if key in accepted
        and accepted[key].get("storePayloadSha256") != _entry_store_digest(desired[key])
    )
    unchanged = sorted(
        key for key in desired
        if key in accepted
        and accepted[key].get("storePayloadSha256") == _entry_store_digest(desired[key])
    )
    retired = sorted(key for key in accepted if key not in desired)
    # A prior post-store failure can leave the receipt pointing at a version
    # that the fact-key transaction already superseded.  Re-store that source
    # even when its bytes reverted to the receipt's old digest.
    for fact_key in set(repair_keys):
        if fact_key not in desired:
            continue
        if fact_key in accepted:
            if fact_key not in changed:
                changed.append(fact_key)
            if fact_key in unchanged:
                unchanged.remove(fact_key)
        elif fact_key not in new:
            new.append(fact_key)
    new.sort()
    changed.sort()
    return new, changed, unchanged, retired


def _pending_candidate_items(receipt: dict[str, Any]) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    seen_fact_keys: set[str] = set()
    for item in receipt.get("pending", []):
        if not isinstance(item, dict) or "candidateId" not in item:
            continue
        fact_key = item.get("factKey")
        memory_id = item.get("candidateId")
        fingerprint = item.get("candidateSha256")
        payload_fingerprint = item.get("candidatePayloadSha256")
        idempotency_key = item.get("idempotencyKey")
        predecessor_id = item.get("candidatePredecessorId", "")
        generation = item.get("candidateGeneration")
        if (
            not isinstance(fact_key, str)
            or not fact_key.startswith("owner-file:")
            or not isinstance(memory_id, str)
            or not MEMORY_ID_RE.fullmatch(memory_id)
            or not isinstance(fingerprint, str)
            or not re.fullmatch(r"[0-9a-f]{64}", fingerprint)
            or (
                payload_fingerprint is not None
                and (
                    not isinstance(payload_fingerprint, str)
                    or not re.fullmatch(r"[0-9a-f]{64}", payload_fingerprint)
                )
            )
            or (
                idempotency_key is not None
                and (
                    not isinstance(idempotency_key, str)
                    or not re.fullmatch(r"owner-file-index-v2:[0-9a-f]{64}", idempotency_key)
                    or payload_fingerprint is None
                )
            )
            or not isinstance(predecessor_id, str)
            or (bool(predecessor_id) and not MEMORY_ID_RE.fullmatch(predecessor_id))
            or (
                idempotency_key is not None
                and (
                    not isinstance(generation, int)
                    or isinstance(generation, bool)
                    or generation < 1
                    or generation >= 2**63
                )
            )
        ):
            raise ReceiptError("owner memory receipt contains an invalid pending candidate")
        if fact_key in seen_fact_keys:
            raise ReceiptError("owner memory receipt contains duplicate pending candidates")
        seen_fact_keys.add(fact_key)
        candidates.append(item)
    return candidates


def _remove_pending_fact(receipt: dict[str, Any], fact_key: str) -> None:
    receipt["pending"] = [
        item
        for item in receipt.get("pending", [])
        if not isinstance(item, dict) or item.get("factKey") != fact_key
    ]


def _record_pending_candidate(
    receipt: dict[str, Any],
    entry: DesiredChunk,
    memory_id: str,
    *,
    idempotency_key: str,
    predecessor_id: str,
    generation: int,
) -> None:
    matched = False
    updated: list[Any] = []
    for item in receipt.get("pending", []):
        if isinstance(item, dict) and item.get("factKey") == entry.fact_key:
            updated.append({
                **item,
                "candidateId": memory_id,
                "candidateSha256": entry.sha256,
                "candidatePayloadSha256": _entry_store_digest(entry),
                "candidatePredecessorId": predecessor_id,
                "candidateGeneration": generation,
                "idempotencyKey": idempotency_key,
                "candidatePreparedAt": utc_now(),
            })
            matched = True
        else:
            updated.append(item)
    if not matched:
        updated.append({
            "operation": "verify_candidate",
            "factKey": entry.fact_key,
            "candidateId": memory_id,
            "candidateSha256": entry.sha256,
            "candidatePayloadSha256": _entry_store_digest(entry),
            "candidatePredecessorId": predecessor_id,
            "candidateGeneration": generation,
            "idempotencyKey": idempotency_key,
            "candidatePreparedAt": utc_now(),
        })
    receipt["pending"] = updated


def _retired_row(
    *, fact_key: str, fingerprint: str, reason: str
) -> dict[str, Any]:
    return {
        "factKey": fact_key,
        "sha256": fingerprint,
        "memoryStatus": "superseded",
        "reason": reason,
        "retiredAt": utc_now(),
    }


def _reconcile_pending_candidates(
    client: Any,
    receipt: dict[str, Any],
    desired: dict[str, DesiredChunk],
    receipt_path: Path,
    scope: Mapping[str, str],
) -> dict[str, str]:
    """Resolve every durably recorded post-store candidate before new writes."""

    repair_predecessors = {
        str(item.get("factKey")): str(
            (receipt.get("accepted", {}).get(str(item.get("factKey"))) or {}).get("id")
            or ""
        )
        for item in receipt.get("pending", [])
        if isinstance(item, dict)
        and isinstance(item.get("factKey"), str)
        and item.get("factKey") in desired
        and "candidateId" not in item
    }
    receipt.setdefault("retired", {})
    for pending in _pending_candidate_items(receipt):
        fact_key = pending["factKey"]
        memory_id = pending["candidateId"]
        fingerprint = pending["candidateSha256"]
        payload_fingerprint = pending.get("candidatePayloadSha256")
        idempotency_key = pending.get("idempotencyKey")
        entry = desired.get(fact_key)
        if idempotency_key and _l22_candidate_id(scope, idempotency_key) != memory_id:
            raise ReceiptError("pending candidate identity does not match its signed principal")
        generation = pending.get("candidateGeneration")
        if idempotency_key and receipt.get("generations", {}).get(fact_key) != generation:
            raise ReceiptError("pending candidate generation does not match its durable intent")
        if (
            idempotency_key
            and entry is not None
            and payload_fingerprint == _entry_store_digest(entry)
        ):
            expected_key, expected_id = _candidate_identity(
                scope,
                entry,
                str(pending.get("candidatePredecessorId") or ""),
                generation,
            )
            if idempotency_key != expected_key or memory_id != expected_id:
                raise ReceiptError("pending candidate does not match its store payload intent")

        verified = False
        if (
            entry is not None
            and entry.sha256 == fingerprint
            and (
                payload_fingerprint is None
                or _entry_store_digest(entry) == payload_fingerprint
            )
        ):
            try:
                verify_entry(client, entry, memory_id)
            except BackendError as exc:
                # A missing/inactive exact record cannot become current, but a
                # semantic outage must retain and reuse the active candidate.
                if exc.code != "exact_readback_failed":
                    raise
                if idempotency_key:
                    status = client.store_status(
                        idempotency_key=idempotency_key,
                        expected_id=memory_id,
                        fact_key=fact_key,
                        generation=generation,
                    )
                    if status.get("status") != "cancelled":
                        # Resolve an uncertain HTTP outcome by replaying the
                        # exact principal-scoped intent. Publication and cancel
                        # share the server's durable serialization point.
                        client.store(
                            entry.text,
                            _entry_metadata(entry, generation=generation),
                            idempotency_key=idempotency_key,
                            expected_id=memory_id,
                            generation=generation,
                        )
                        try:
                            verify_entry(client, entry, memory_id)
                        except BackendError as retry_exc:
                            if retry_exc.code != "exact_readback_failed":
                                raise
                        else:
                            verified = True
            else:
                verified = True

            if verified:
                previous = receipt["accepted"].get(fact_key)
                if previous and previous.get("id") != memory_id:
                    retire_accepted_record(
                        client,
                        fact_key,
                        previous,
                        reason="owner_pending_candidate_committed",
                    )
                    receipt["retired"][previous["id"]] = _retired_row(
                        fact_key=fact_key,
                        fingerprint=previous["sha256"],
                        reason="owner_pending_candidate_committed",
                    )
                receipt["accepted"][fact_key] = _accepted_row(
                    entry,
                    memory_id,
                    utc_now(),
                    idempotency_key=idempotency_key,
                    generation=generation,
                )
                _remove_pending_fact(receipt, fact_key)
                receipt["retired"] = _trim_retired(receipt["retired"])
                atomic_write_receipt(receipt_path, receipt)
                continue

        # The candidate is inactive, or no longer represents the current
        # source. A missing backend row is not deletion proof: durably fence
        # the exact principal/key/generation before retiring the receipt.
        if idempotency_key:
            client.cancel_store(
                idempotency_key=idempotency_key,
                expected_id=memory_id,
                fact_key=fact_key,
                generation=generation,
                reason="owner_pending_candidate_abandoned",
            )
            if client.read(memory_id) is not None:
                raise BackendError(
                    "cancelled candidate remained visible",
                    code="store_cancel_visibility_failed",
                )
        else:
            retire_record(client, memory_id, reason="owner_pending_candidate_abandoned")
        receipt["retired"][memory_id] = _retired_row(
            fact_key=fact_key,
            fingerprint=fingerprint,
            reason="owner_pending_candidate_abandoned",
        )
        _remove_pending_fact(receipt, fact_key)
        receipt["retired"] = _trim_retired(receipt["retired"])
        if entry is not None:
            repair_predecessors[fact_key] = memory_id
        atomic_write_receipt(receipt_path, receipt)
    return repair_predecessors


def _snapshot_digest(policy_digest: str, desired: dict[str, DesiredChunk], sources: dict[str, Any]) -> str:
    return canonical_digest({
        "policyDigest": policy_digest,
        "chunks": {key: entry.sha256 for key, entry in sorted(desired.items())},
        "sources": sources,
    })


def _validate_receipt_scope(receipt: dict[str, Any], scope_digest: str, *, legacy: bool) -> None:
    stored = str(receipt.get("scopeDigest") or "")
    if not legacy and receipt.get("accepted") and stored != scope_digest:
        raise AuthorizationBoundaryError("receipt belongs to a different signed principal")
    if not legacy and stored and stored != scope_digest:
        raise AuthorizationBoundaryError("receipt scope changed; use a separate receipt")


def _verify_legacy_scope(client: Any, receipt: dict[str, Any]) -> None:
    for fact_key, accepted in receipt["accepted"].items():
        record = client.read(accepted["id"])
        if not isinstance(record, dict) or digest(str(record.get("text") or "")) != accepted["sha256"]:
            raise AuthorizationBoundaryError(
                f"legacy receipt record cannot be proven in the signed owner scope: {fact_key}"
            )


def _receipt_differs(
    receipt: dict[str, Any], desired: dict[str, DesiredChunk], sources: dict[str, Any],
    policy_digest: str, scope_digest: str,
) -> bool:
    new, changed, _unchanged, retired = _plan(receipt, desired)
    return bool(
        new or changed or retired
        or receipt.get("sources") != sources
        or receipt.get("policyDigest") != policy_digest
        or receipt.get("scopeDigest") != scope_digest
    )


def _result(
    *, mode: str, status: str, health: str, policies: list[SourcePolicy], desired: dict[str, DesiredChunk],
    new: int, changed: int, retired: int, skipped: int, scope_digest: str,
    semantic_checked: int = 0, reason: str | None = None,
) -> dict[str, Any]:
    result: dict[str, Any] = {
        "mode": mode,
        "status": status,
        "health": health,
        "sourceCount": len(policies),
        "chunkCount": len(desired),
        "new": new,
        "changed": changed,
        "retired": retired,
        "skipped": skipped,
        "semanticReadback": {"checked": semantic_checked, "verified": semantic_checked if health == "healthy" else 0},
        "scopeDigest": scope_digest,
        "privacyBoundary": PRIVACY_BLOCKER,
    }
    if reason:
        result["reason"] = reason
    return result


def _parse_arguments(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", nargs="?", choices=("dry-run", "apply", "check"))
    legacy = parser.add_mutually_exclusive_group()
    legacy.add_argument("--apply", action="store_true", dest="legacy_apply")
    legacy.add_argument("--check", action="store_true", dest="legacy_check")
    parser.add_argument("--config", type=Path, default=CONFIG)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--manifest", type=Path, default=MANIFEST)
    parser.add_argument("--receipt", type=Path, default=RECEIPT)
    parser.add_argument("--lock", type=Path, default=LOCK)
    args = parser.parse_args(argv)
    requested = args.mode
    if args.legacy_apply:
        if requested:
            parser.error("mode and --apply are mutually exclusive")
        requested = "apply"
    if args.legacy_check:
        if requested:
            parser.error("mode and --check are mutually exclusive")
        requested = "check"
    args.mode = requested or "dry-run"
    return args


def main(
    argv: list[str] | None = None,
    *,
    client_factory: Callable[..., Any] = HttpMemoryClient,
) -> dict[str, Any]:
    args = _parse_arguments(argv)
    config = _read_json(args.config, label="config")
    assert config is not None
    plugin, scope, signature = signed_scope(config)
    scope_digest = canonical_digest(scope)
    policies, policy_digest = load_policy(args.manifest)
    desired, sources = collect_desired(
        args.root, policies, scope_digest=scope_digest
    )
    initial_snapshot = _snapshot_digest(policy_digest, desired, sources)

    args.lock.parent.mkdir(parents=True, exist_ok=True)
    with args.lock.open("a+b") as lock_file:
        os.chmod(args.lock, 0o600)
        fcntl.flock(lock_file, fcntl.LOCK_EX)
        receipt, existed, legacy = load_receipt(args.receipt)
        _validate_receipt_scope(receipt, scope_digest, legacy=legacy)
        new, changed, unchanged, retired = _plan(receipt, desired)
        source_state_changed = receipt.get("sources") != sources or receipt.get("policyDigest") != policy_digest

        if args.mode == "dry-run":
            return _result(
                mode="dry_run", status="would_change" if (new or changed or retired or source_state_changed) else "unverified",
                health="unknown", policies=policies, desired=desired, new=len(new), changed=len(changed),
                retired=len(retired), skipped=len(unchanged), scope_digest=scope_digest,
                reason="dry_run_never_asserts_backend_health",
            )

        client = client_factory(plugin=plugin, scope=scope, signature=signature)
        if legacy:
            if args.mode == "check":
                raise ReceiptError("legacy receipt requires an apply migration with scoped readback")
            _verify_legacy_scope(client, receipt)
            receipt["schemaVersion"] = RECEIPT_SCHEMA
            receipt["authorizationBoundary"] = AUTHORIZATION_BOUNDARY
            receipt["scopeDigest"] = scope_digest
            receipt["policyDigest"] = ""

        if args.mode == "check":
            try:
                if not existed:
                    raise IndexingFailure("owner memory receipt is missing", code="receipt_missing")
                if receipt.get("lastRun", {}).get("status") != "current" or receipt.get("pending"):
                    raise IndexingFailure("owner memory work is pending or failed", code="pending_or_failed")
                if _receipt_differs(receipt, desired, sources, policy_digest, scope_digest):
                    raise IndexingFailure("approved sources and receipt disagree", code="freshness_stale")
                for fact_key, entry in desired.items():
                    accepted = receipt["accepted"].get(fact_key)
                    if not accepted:
                        raise IndexingFailure("receipt omitted an approved chunk", code="freshness_stale")
                    verify_entry(client, entry, accepted["id"])
            except Exception as exc:
                failure = exc if isinstance(exc, IndexingFailure) else IndexingFailure(
                    "unexpected owner health-check failure", code="unexpected_failure"
                )
                if existed and not legacy:
                    checked_at = utc_now()
                    receipt["lastCheck"] = {"status": "failed", "checkedAt": checked_at, "reason": failure.code}
                    receipt["health"] = {"status": "degraded", "checkedAt": checked_at, "reason": failure.code}
                    atomic_write_receipt(args.receipt, receipt)
                raise failure from (None if failure is exc else exc)
            checked_at = utc_now()
            missing_sources = [path for path, state in sources.items() if state.get("state") == "deleted"]
            if not desired or missing_sources:
                degraded_reason = "approved_sources_missing" if missing_sources else "no_approved_records_to_verify"
                receipt["lastCheck"] = {
                    "status": "degraded", "checkedAt": checked_at,
                    "reason": degraded_reason,
                }
                receipt["health"] = {
                    "status": "degraded", "checkedAt": checked_at,
                    "reason": degraded_reason, "semanticVerified": len(desired),
                    "missingSources": missing_sources,
                }
                atomic_write_receipt(args.receipt, receipt)
                return _result(
                    mode="check", status="degraded", health="degraded", policies=policies, desired=desired,
                    new=0, changed=0, retired=0, skipped=len(desired), scope_digest=scope_digest,
                    semantic_checked=len(desired), reason=degraded_reason,
                )
            receipt["lastCheck"] = {
                "status": "healthy", "checkedAt": checked_at, "semanticVerified": len(desired),
            }
            receipt["health"] = {
                "status": "healthy", "reason": "semantic_readback_verified",
                "checkedAt": checked_at, "semanticVerified": len(desired),
            }
            atomic_write_receipt(args.receipt, receipt)
            return _result(
                mode="check", status="current", health="healthy", policies=policies, desired=desired,
                new=0, changed=0, retired=0, skipped=len(desired), scope_digest=scope_digest,
                semantic_checked=len(desired),
            )

        repair_predecessors = _reconcile_pending_candidates(
            client,
            receipt,
            desired,
            args.receipt,
            scope,
        )
        new, changed, unchanged, retired = _plan(
            receipt,
            desired,
            repair_keys=repair_predecessors,
        )
        started_at = utc_now()
        operations = [
            *({"operation": "store", "factKey": key} for key in new),
            *({"operation": "replace", "factKey": key} for key in changed),
            *({"operation": "retire", "factKey": key} for key in retired),
        ]
        receipt.update({
            "schemaVersion": RECEIPT_SCHEMA,
            "authorizationBoundary": AUTHORIZATION_BOUNDARY,
            "scopeDigest": scope_digest,
            "privacyBoundary": PRIVACY_BLOCKER,
            "pending": operations,
            "lastRun": {"status": "pending", "startedAt": started_at},
            "health": {"status": "degraded", "reason": "work_pending", "checkedAt": started_at},
        })
        receipt.setdefault("retired", {})
        atomic_write_receipt(args.receipt, receipt)

        try:
            for fact_key in [*new, *changed]:
                entry = desired[fact_key]
                previous = receipt["accepted"].get(fact_key)
                predecessor_id = str(
                    repair_predecessors.get(fact_key)
                    or (previous or {}).get("id")
                    or ""
                )
                previous_generation = receipt.setdefault("generations", {}).get(fact_key, 0)
                if (
                    not isinstance(previous_generation, int)
                    or isinstance(previous_generation, bool)
                    or previous_generation < 0
                    or previous_generation >= 2**63 - 1
                ):
                    raise ReceiptError("owner memory generation cannot be advanced")
                generation = previous_generation + 1
                idempotency_key, memory_id = _candidate_identity(
                    scope, entry, predecessor_id, generation
                )
                # Persist the deterministic L22 intent before any HTTP side
                # effect. A crash or lost response can therefore be reconciled
                # by exact ID/idempotency replay on the next apply.
                _record_pending_candidate(
                    receipt,
                    entry,
                    memory_id,
                    idempotency_key=idempotency_key,
                    predecessor_id=predecessor_id,
                    generation=generation,
                )
                receipt["generations"][fact_key] = generation
                atomic_write_receipt(args.receipt, receipt)
                stored = client.store(
                    entry.text,
                    _entry_metadata(entry, generation=generation),
                    idempotency_key=idempotency_key,
                    expected_id=memory_id,
                    generation=generation,
                )
                if stored.get("id") != memory_id:
                    raise BackendError(
                        "Cortex returned a mismatched deterministic candidate",
                        code="store_identity_mismatch",
                    )
                verify_entry(client, entry, memory_id)
                if previous and previous.get("id") != memory_id:
                    retire_accepted_record(
                        client,
                        fact_key,
                        previous,
                        reason="owner_source_chunk_replaced",
                    )
                    receipt["retired"][previous["id"]] = _retired_row(
                        fact_key=fact_key,
                        fingerprint=previous["sha256"],
                        reason="owner_source_chunk_replaced",
                    )
                receipt["accepted"][fact_key] = _accepted_row(
                    entry,
                    memory_id,
                    utc_now(),
                    idempotency_key=idempotency_key,
                    generation=generation,
                )
                _remove_pending_fact(receipt, fact_key)
                receipt["retired"] = _trim_retired(receipt["retired"])
                atomic_write_receipt(args.receipt, receipt)

            for fact_key in retired:
                previous = receipt["accepted"][fact_key]
                retire_accepted_record(
                    client,
                    fact_key,
                    previous,
                    reason="owner_source_deleted_or_revoked",
                )
                receipt["retired"][previous["id"]] = _retired_row(
                    fact_key=fact_key,
                    fingerprint=previous["sha256"],
                    reason="owner_source_deleted_or_revoked",
                )
                del receipt["accepted"][fact_key]
                _remove_pending_fact(receipt, fact_key)
                receipt["retired"] = _trim_retired(receipt["retired"])
                atomic_write_receipt(args.receipt, receipt)

            final_policies, final_policy_digest = load_policy(args.manifest)
            final_desired, final_sources = collect_desired(
                args.root, final_policies, scope_digest=scope_digest
            )
            if _snapshot_digest(final_policy_digest, final_desired, final_sources) != initial_snapshot:
                receipt["pending"].append({"operation": "rescan", "reason": "source_changed_during_run"})
                raise IndexingFailure("approved sources changed during refresh", code="source_changed_during_run")
            for fact_key, entry in desired.items():
                accepted = receipt["accepted"].get(fact_key)
                if (
                    not accepted
                    or accepted.get("storePayloadSha256") != _entry_store_digest(entry)
                ):
                    raise IndexingFailure("accepted receipt is incomplete", code="receipt_incomplete")
                verify_entry(client, entry, accepted["id"])
                receipt["accepted"][fact_key] = _accepted_row(
                    entry,
                    accepted["id"],
                    utc_now(),
                    idempotency_key=accepted.get("idempotencyKey"),
                    generation=accepted.get("generation"),
                )

            completed_at = utc_now()
            missing_sources = [path for path, state in sources.items() if state.get("state") == "deleted"]
            semantic_health = "healthy" if desired and not missing_sources else "degraded"
            health_reason = (
                "semantic_readback_verified" if semantic_health == "healthy"
                else ("approved_sources_missing" if missing_sources else "no_approved_records_to_verify")
            )
            receipt.update({
                "policyDigest": policy_digest,
                "scopeDigest": scope_digest,
                "sources": sources,
                "pending": [],
                "lastRun": {
                    "status": "current",
                    "startedAt": started_at,
                    "completedAt": completed_at,
                    "new": len(new),
                    "changed": len(changed),
                    "retired": len(retired),
                    "semanticVerified": len(desired),
                },
                "health": {
                    "status": semantic_health,
                    "reason": health_reason,
                    "checkedAt": completed_at,
                    "semanticVerified": len(desired),
                    "missingSources": missing_sources,
                },
            })
            atomic_write_receipt(args.receipt, receipt)
            return _result(
                mode="apply", status="current" if desired else "degraded", health=semantic_health,
                policies=policies, desired=desired, new=len(new), changed=len(changed), retired=len(retired),
                skipped=len(unchanged), scope_digest=scope_digest, semantic_checked=len(desired),
                reason=None if semantic_health == "healthy" else health_reason,
            )
        except Exception as exc:
            failure = exc if isinstance(exc, IndexingFailure) else IndexingFailure(
                "unexpected owner indexing failure", code="unexpected_failure"
            )
            if not receipt.get("pending"):
                receipt["pending"] = [{"operation": "verification", "reason": failure.code}]
            failed_at = utc_now()
            receipt["lastRun"] = {
                "status": "failed",
                "startedAt": started_at,
                "failedAt": failed_at,
                "reason": failure.code,
            }
            receipt["health"] = {"status": "degraded", "reason": failure.code, "checkedAt": failed_at}
            atomic_write_receipt(args.receipt, receipt)
            raise failure from (None if failure is exc else exc)


def cli(argv: list[str] | None = None) -> int:
    try:
        result = main(argv)
    except IndexingFailure as exc:
        print(json.dumps({
            "status": "degraded",
            "health": "degraded",
            "reason": exc.code,
            "privacyBoundary": PRIVACY_BLOCKER,
        }, sort_keys=True))
        return 1
    print(json.dumps(result, sort_keys=True))
    return 0 if result.get("health") == "healthy" else 1


if __name__ == "__main__":
    raise SystemExit(cli())
