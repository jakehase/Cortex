#!/usr/bin/env python3
"""Authenticate the frozen v2 plan and copy only its exact terminal evidence set."""

import argparse
import base64
import datetime
import fcntl
import hashlib
import hmac
import json
import os
import pathlib
import re
import stat
import subprocess
import sys
import tempfile
import time
import uuid


DIGEST = re.compile(r"^[0-9a-f]{64}$")
COMMIT = re.compile(r"^[0-9a-f]{40}$")
KEY_ID = re.compile(r"^[0-9a-f]{16}$")
IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$")
SAFE_PATH = re.compile(r"^/[A-Za-z0-9._/-]+$")
SAFE_HOST = re.compile(r"^[A-Za-z0-9._-]+@[A-Za-z0-9._:-]+$")
STAGING_JOURNAL_SCHEMA = "cortex.learning_os.phd_harvest_staging_journal.v1"
WORKER_BLOCKER_SCHEMA = "cortex.learning_os.phd_worker_blocker.v1"
LIVE_WORKER_SCHEMA = "cortex.learning_os.phd_live_worker_reconciliation.v2"
UNIT_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.@:-]{0,255}$")
HARVEST_LOCK_NAME = ".harvest.lock"
HARVEST_STATE_SCHEMA = "cortex.learning_os.phd_harvest_state.v2"
HARVEST_STATE_STATUSES = {
    "running",
    "failed",
    "ready_for_independent_replay",
}


def atomic_json(target: pathlib.Path, payload: dict) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=target.parent, delete=False) as handle:
        json.dump(payload, handle, indent=2, sort_keys=True)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
        temporary = pathlib.Path(handle.name)
    temporary.chmod(0o600)
    temporary.replace(target)
    fsync_directory(target.parent)


def exact_json_bytes(payload: dict) -> bytes:
    return (
        json.dumps(payload, indent=2, sort_keys=True, ensure_ascii=False) + "\n"
    ).encode("utf-8")


def reject_duplicate_object_keys(pairs: list[tuple[str, object]]) -> dict:
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError(f"duplicate JSON key: {key}")
        value[key] = item
    return value


def _state_stat_identity(value: os.stat_result) -> tuple[int, ...]:
    return (
        value.st_dev,
        value.st_ino,
        value.st_uid,
        value.st_gid,
        value.st_mode,
        value.st_nlink,
        value.st_size,
        value.st_mtime_ns,
        value.st_ctime_ns,
    )


def _read_harvest_state_descriptor(descriptor: int) -> tuple[dict, str, bytes, tuple[int, ...]]:
    target_stat = os.fstat(descriptor)
    if (
        not stat.S_ISREG(target_stat.st_mode)
        or target_stat.st_uid != os.geteuid()
        or target_stat.st_gid != os.getegid()
        or stat.S_IMODE(target_stat.st_mode) != 0o600
        or target_stat.st_nlink != 1
        or target_stat.st_size < 2
        or target_stat.st_size > 16 * 1024 * 1024
    ):
        raise ValueError("qualification harvest state file metadata is unsafe")
    expected_identity = _state_stat_identity(target_stat)
    raw = bytearray()
    offset = 0
    while len(raw) < target_stat.st_size:
        block = os.pread(descriptor, target_stat.st_size - len(raw), offset)
        if not block:
            raise ValueError("qualification harvest state was truncated while reading")
        raw.extend(block)
        offset += len(block)
    if os.pread(descriptor, 1, target_stat.st_size):
        raise ValueError("qualification harvest state grew while reading")
    if _state_stat_identity(os.fstat(descriptor)) != expected_identity:
        raise ValueError("qualification harvest state changed while reading")
    encoded = bytes(raw)
    value = json.loads(
        encoded.decode("utf-8"),
        object_pairs_hook=reject_duplicate_object_keys,
    )
    if not isinstance(value, dict):
        raise ValueError("qualification harvest state is not a JSON object")
    return value, hashlib.sha256(encoded).hexdigest(), encoded, expected_identity


def _open_harvest_state_parent(target: pathlib.Path) -> tuple[int, tuple[int, ...]]:
    descriptor = os.open(
        target.parent,
        os.O_RDONLY
        | getattr(os, "O_DIRECTORY", 0)
        | getattr(os, "O_NOFOLLOW", 0)
        | getattr(os, "O_CLOEXEC", 0),
    )
    identity = _state_stat_identity(os.fstat(descriptor))
    parent_stat = os.fstat(descriptor)
    if (
        not stat.S_ISDIR(parent_stat.st_mode)
        or parent_stat.st_uid != os.geteuid()
        or parent_stat.st_gid != os.getegid()
        or parent_stat.st_mode & 0o077
    ):
        os.close(descriptor)
        raise ValueError("qualification harvest state parent metadata is unsafe")
    return descriptor, identity


def read_harvest_state(
    target: pathlib.Path,
) -> tuple[dict | None, str | None]:
    parent_descriptor, parent_identity = _open_harvest_state_parent(target)
    descriptor = None
    named_descriptor = None
    try:
        descriptor = os.open(
            target.name,
            os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_CLOEXEC", 0),
            dir_fd=parent_descriptor,
        )
    except FileNotFoundError:
        os.close(parent_descriptor)
        return None, None
    except BaseException:
        os.close(parent_descriptor)
        raise
    try:
        value, digest, raw, identity = _read_harvest_state_descriptor(descriptor)
        named_descriptor = os.open(
            target.name,
            os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_CLOEXEC", 0),
            dir_fd=parent_descriptor,
        )
        named_value, named_digest, named_raw, named_identity = (
            _read_harvest_state_descriptor(named_descriptor)
        )
        reopened_parent = os.open(
            target.parent,
            os.O_RDONLY
            | getattr(os, "O_DIRECTORY", 0)
            | getattr(os, "O_NOFOLLOW", 0)
            | getattr(os, "O_CLOEXEC", 0),
        )
        try:
            if (
                identity != named_identity
                or raw != named_raw
                or digest != named_digest
                or value != named_value
                or _state_stat_identity(os.fstat(parent_descriptor)) != parent_identity
                or _state_stat_identity(os.fstat(reopened_parent)) != parent_identity
            ):
                raise ValueError("qualification harvest state changed during its named read")
        finally:
            os.close(reopened_parent)
        return value, digest
    finally:
        if named_descriptor is not None:
            os.close(named_descriptor)
        if descriptor is not None:
            os.close(descriptor)
        os.close(parent_descriptor)


def adopt_durable_harvest_state(
    target: pathlib.Path,
    args: argparse.Namespace,
    signing_secret: str,
    *,
    required_status: str | None = None,
) -> tuple[dict, str]:
    parent_descriptor, parent_identity = _open_harvest_state_parent(target)
    descriptor = None
    named_descriptor = None
    try:
        descriptor = os.open(
            target.name,
            os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_CLOEXEC", 0),
            dir_fd=parent_descriptor,
        )
        value, digest, raw, identity = _read_harvest_state_descriptor(descriptor)
        if (
            not state_matches_campaign(value, args, signing_secret)
            or (required_status is not None and value.get("status") != required_status)
        ):
            raise ValueError("existing qualification harvest state is unauthenticated or mismatched")
        os.fsync(descriptor)
        os.fsync(parent_descriptor)
        pinned_value, pinned_digest, pinned_raw, pinned_identity = (
            _read_harvest_state_descriptor(descriptor)
        )
        named_descriptor = os.open(
            target.name,
            os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_CLOEXEC", 0),
            dir_fd=parent_descriptor,
        )
        named_value, named_digest, named_raw, named_identity = (
            _read_harvest_state_descriptor(named_descriptor)
        )
        reopened_parent = os.open(
            target.parent,
            os.O_RDONLY
            | getattr(os, "O_DIRECTORY", 0)
            | getattr(os, "O_NOFOLLOW", 0)
            | getattr(os, "O_CLOEXEC", 0),
        )
        try:
            if (
                identity != pinned_identity
                or pinned_identity != named_identity
                or raw != pinned_raw
                or pinned_raw != named_raw
                or digest != pinned_digest
                or pinned_digest != named_digest
                or value != pinned_value
                or pinned_value != named_value
                or _state_stat_identity(os.fstat(parent_descriptor)) != parent_identity
                or _state_stat_identity(os.fstat(reopened_parent)) != parent_identity
                or not state_matches_campaign(named_value, args, signing_secret)
                or (
                    required_status is not None
                    and named_value.get("status") != required_status
                )
            ):
                raise ValueError(
                    "qualification harvest state changed across its durability barrier"
                )
        finally:
            os.close(reopened_parent)
        return named_value, named_digest
    finally:
        if named_descriptor is not None:
            os.close(named_descriptor)
        if descriptor is not None:
            os.close(descriptor)
        os.close(parent_descriptor)


def state_matches_campaign(value: object, args: argparse.Namespace, secret: str) -> bool:
    return (
        isinstance(value, dict)
        and value.get("schemaVersion") == HARVEST_STATE_SCHEMA
        and value.get("status") in HARVEST_STATE_STATUSES
        and value.get("planDigest") == args.expected_plan_digest
        and value.get("subjectId") == args.expected_subject_id
        and value.get("campaignId") == args.expected_campaign_id
        and value.get("campaignDigest") == args.expected_campaign_digest
        and value.get("deploymentDigest") == args.expected_deployment_digest
        and value.get("descriptorSetSha256") == args.expected_descriptor_set_sha256
        and value.get("jobSetSha256") == args.expected_job_set_sha256
        and value.get("productTree") == args.expected_product_tree
        and value.get("runtimeSha256") == args.expected_runtime_sha256
        and value.get("closureSha256") == args.expected_closure_sha256
        and DIGEST.fullmatch(str(value.get("liveWorkerSetSha256") or ""))
        and (
            getattr(args, "live_worker_set_sha256", None) is None
            or value.get("liveWorkerSetSha256") == args.live_worker_set_sha256
        )
        and value.get("expectedJobCount") == args.expected_job_count
        and verify_control_signature(value, secret)
    )


def publish_harvest_state(
    target: pathlib.Path,
    payload: dict,
    *,
    expected_sha256: str | None,
    args: argparse.Namespace,
    signing_secret: str,
    crash_injector=None,
) -> tuple[str, str]:
    if payload.get("status") not in HARVEST_STATE_STATUSES:
        raise ValueError("invalid qualification harvest state transition")
    signed = sign_record(payload, signing_secret)
    if not state_matches_campaign(signed, args, signing_secret):
        raise ValueError("qualification harvest state binding is invalid")
    current, current_sha256 = read_harvest_state(target)
    if current is not None and not state_matches_campaign(current, args, signing_secret):
        raise ValueError("existing qualification harvest state is unauthenticated or mismatched")
    if current is not None and current.get("status") == "ready_for_independent_replay":
        _, adopted_sha256 = adopt_durable_harvest_state(
            target,
            args,
            signing_secret,
            required_status="ready_for_independent_replay",
        )
        return "adopted_ready", adopted_sha256
    if current_sha256 != expected_sha256:
        raise ValueError("qualification harvest state compare-and-swap predecessor changed")

    encoded = exact_json_bytes(signed)
    temporary = target.parent / (
        f".{target.name}.{os.getpid()}.{uuid.uuid4().hex}.tmp"
    )
    descriptor = None
    try:
        descriptor = os.open(
            temporary,
            os.O_CREAT
            | os.O_EXCL
            | os.O_WRONLY
            | getattr(os, "O_NOFOLLOW", 0)
            | getattr(os, "O_CLOEXEC", 0),
            0o600,
        )
        written = 0
        while written < len(encoded):
            block_size = os.write(descriptor, encoded[written:])
            if block_size <= 0:
                raise OSError("qualification harvest state write did not advance")
            written += block_size
        os.fchmod(descriptor, 0o600)
        os.fsync(descriptor)
        if crash_injector is not None:
            crash_injector("after_state_fsync")
        os.close(descriptor)
        descriptor = None
        revalidated, revalidated_sha256 = read_harvest_state(target)
        if revalidated_sha256 != expected_sha256:
            if (
                revalidated is not None
                and state_matches_campaign(revalidated, args, signing_secret)
                and revalidated.get("status") == "ready_for_independent_replay"
            ):
                _, adopted_sha256 = adopt_durable_harvest_state(
                    target,
                    args,
                    signing_secret,
                    required_status="ready_for_independent_replay",
                )
                return "adopted_ready", adopted_sha256
            raise ValueError("qualification harvest state compare-and-swap predecessor changed")
        temporary.replace(target)
        if crash_injector is not None:
            crash_injector("after_state_replace_before_parent_fsync")
        _, committed_sha256 = adopt_durable_harvest_state(
            target,
            args,
            signing_secret,
        )
        if crash_injector is not None:
            crash_injector("after_state_replace")
        if committed_sha256 != hashlib.sha256(encoded).hexdigest():
            raise ValueError("qualification harvest state changed after replacement")
        return "published", committed_sha256
    finally:
        if descriptor is not None:
            os.close(descriptor)
        try:
            temporary.unlink()
            fsync_directory(target.parent)
        except FileNotFoundError:
            pass


def acquire_campaign_harvest_lock(
    lock_path: pathlib.Path,
    state_file: pathlib.Path,
) -> int:
    if lock_path.name != HARVEST_LOCK_NAME or lock_path.parent != state_file.parent:
        raise ValueError("qualification harvest lock is not campaign-scoped")
    parent_stat = lock_path.parent.stat(follow_symlinks=False)
    if (
        not stat.S_ISDIR(parent_stat.st_mode)
        or parent_stat.st_uid != os.geteuid()
        or parent_stat.st_gid != os.getegid()
        or parent_stat.st_mode & 0o077
    ):
        raise ValueError("qualification harvest campaign directory is unsafe")
    descriptor = os.open(
        lock_path,
        os.O_CREAT
        | os.O_RDWR
        | getattr(os, "O_NOFOLLOW", 0)
        | getattr(os, "O_CLOEXEC", 0),
        0o600,
    )
    try:
        lock_stat = os.fstat(descriptor)
        if (
            not stat.S_ISREG(lock_stat.st_mode)
            or lock_stat.st_uid != os.geteuid()
            or lock_stat.st_gid != os.getegid()
            or stat.S_IMODE(lock_stat.st_mode) != 0o600
            or lock_stat.st_nlink != 1
        ):
            raise ValueError("qualification harvest campaign lock is unsafe")
        fcntl.flock(descriptor, fcntl.LOCK_EX)
        named_stat = lock_path.stat(follow_symlinks=False)
        locked_stat = os.fstat(descriptor)
        if (
            not stat.S_ISREG(named_stat.st_mode)
            or named_stat.st_dev != locked_stat.st_dev
            or named_stat.st_ino != locked_stat.st_ino
            or named_stat.st_nlink != 1
        ):
            raise ValueError("qualification harvest campaign lock pathname changed")
        fsync_directory(lock_path.parent)
        return descriptor
    except Exception:
        os.close(descriptor)
        raise


def fsync_directory(target: pathlib.Path) -> None:
    descriptor = os.open(target, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def fsync_tree(root: pathlib.Path) -> None:
    directories = [root]
    for target in sorted(root.rglob("*")):
        if target.is_symlink():
            raise ValueError("cannot durably publish a staging tree containing a symlink")
        if target.is_file():
            descriptor = os.open(target, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
            try:
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
        elif target.is_dir():
            directories.append(target)
    for directory in reversed(directories):
        fsync_directory(directory)


def ensure_owner_protected_directory(target: pathlib.Path, label: str) -> None:
    target.mkdir(parents=True, exist_ok=True, mode=0o700)
    target.chmod(0o700)
    stat = target.lstat()
    if (target.is_symlink() or not target.is_dir() or stat.st_uid != os.geteuid()
            or stat.st_mode & 0o077):
        raise ValueError(f"{label} must be a caller-owned owner-only directory")


def sha256_file(target: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with target.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def canonical_digest(value: object) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def byte_record_matches(record: object, payload: bytes) -> bool:
    return (
        isinstance(record, dict)
        and record.get("bytes") == len(payload)
        and record.get("sha256") == hashlib.sha256(payload).hexdigest()
    )


def canonical_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def valid_worker_blocker(value: object) -> bool:
    return (
        isinstance(value, dict)
        and set(value) == {"schemaVersion", "code", "phase", "message"}
        and value.get("schemaVersion") == WORKER_BLOCKER_SCHEMA
        and value.get("code") in {"mechanically_invalid", "worker_exception"}
        and value.get("phase") in {
            "inert_execution", "model_execution", "worker_exception",
        }
        and isinstance(value.get("message"), str)
        and 1 <= len(value["message"]) <= 1000
        and value["message"] == " ".join(value["message"].split())
    )


def unsigned_record(value: dict) -> dict:
    return {key: item for key, item in value.items() if key != "controlPlaneSignature"}


def key_id(secret: str) -> str:
    return hashlib.sha256(secret.encode("utf-8")).hexdigest()[:16]


def sign_record(value: dict, secret: str) -> dict:
    return {
        **value,
        "controlPlaneSignature": {
            "algorithm": "hmac-sha256",
            "keyId": key_id(secret),
            "digest": hmac.new(
                secret.encode("utf-8"),
                canonical_json(value).encode("utf-8"),
                hashlib.sha256,
            ).hexdigest(),
        },
    }


def verify_control_signature(value: object, secret: str) -> bool:
    if not isinstance(value, dict):
        return False
    signature = value.get("controlPlaneSignature")
    if (not isinstance(signature, dict)
            or set(signature) != {"algorithm", "keyId", "digest"}
            or signature.get("algorithm") != "hmac-sha256"
            or signature.get("keyId") != key_id(secret)):
        return False
    expected = hmac.new(
        secret.encode("utf-8"),
        canonical_json(unsigned_record(value)).encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(str(signature.get("digest") or ""), expected)


def read_authority_bytes(
    target: pathlib.Path,
    *,
    label: str,
    minimum: int,
    maximum: int,
) -> bytes:
    resolved = pathlib.Path(os.path.abspath(target))
    components = resolved.parent.parts[1:]
    directory = os.open(
        "/",
        os.O_RDONLY
        | getattr(os, "O_DIRECTORY", 0)
        | getattr(os, "O_NOFOLLOW", 0)
        | getattr(os, "O_CLOEXEC", 0),
    )
    filesystem_uid = os.fstat(directory).st_uid
    try:
        for component in components:
            ancestor = os.fstat(directory)
            sticky_world_writable = (
                ancestor.st_mode & stat.S_ISVTX
                and ancestor.st_mode & stat.S_IWOTH
                and ancestor.st_uid == filesystem_uid
            )
            if (
                not stat.S_ISDIR(ancestor.st_mode)
                or ancestor.st_nlink < 1
                or ancestor.st_uid not in {filesystem_uid, os.geteuid()}
                or (
                    ancestor.st_mode & (stat.S_IWGRP | stat.S_IWOTH)
                    and not sticky_world_writable
                )
            ):
                raise ValueError(f"{label} ancestor is unsafe")
            child = os.open(
                component,
                os.O_RDONLY
                | getattr(os, "O_DIRECTORY", 0)
                | getattr(os, "O_NOFOLLOW", 0)
                | getattr(os, "O_CLOEXEC", 0),
                dir_fd=directory,
            )
            os.close(directory)
            directory = child
        parent = os.fstat(directory)
        sticky_world_writable = (
            parent.st_mode & stat.S_ISVTX
            and parent.st_mode & stat.S_IWOTH
            and parent.st_uid == filesystem_uid
        )
        if (
            not stat.S_ISDIR(parent.st_mode)
            or parent.st_nlink < 1
            or parent.st_uid not in {filesystem_uid, os.geteuid()}
            or (
                parent.st_mode & (stat.S_IWGRP | stat.S_IWOTH)
                and not sticky_world_writable
            )
        ):
            raise ValueError(f"{label} parent is unsafe")
        flags = (
            os.O_RDONLY
            | getattr(os, "O_NOFOLLOW", 0)
            | getattr(os, "O_NONBLOCK", 0)
            | getattr(os, "O_CLOEXEC", 0)
        )
        descriptor = os.open(resolved.name, flags, dir_fd=directory)
        named_descriptor = None
        try:
            before = os.fstat(descriptor)
            if (
                not stat.S_ISREG(before.st_mode)
                or before.st_uid != os.geteuid()
                or before.st_gid != os.getegid()
                or stat.S_IMODE(before.st_mode) not in {0o400, 0o600}
                or before.st_nlink != 1
                or before.st_dev != parent.st_dev
                or before.st_size < minimum
                or before.st_size > maximum
            ):
                raise ValueError(
                    f"{label} must be a bounded, single-link, caller-owned owner-only regular file"
                )

            def identity(value: os.stat_result) -> tuple:
                return (
                    value.st_dev,
                    value.st_ino,
                    value.st_uid,
                    value.st_gid,
                    value.st_mode,
                    value.st_nlink,
                    value.st_size,
                    value.st_mtime_ns,
                    value.st_ctime_ns,
                )

            first = os.pread(descriptor, before.st_size + 1, 0)
            after_read = os.fstat(descriptor)
            named_descriptor = os.open(resolved.name, flags, dir_fd=directory)
            named = os.fstat(named_descriptor)
            second = os.pread(descriptor, before.st_size + 1, 0)
            committed = os.fstat(descriptor)
            if (
                len(first) != before.st_size
                or first != second
                or identity(before) != identity(after_read)
                or identity(after_read) != identity(named)
                or identity(named) != identity(committed)
            ):
                raise ValueError(f"{label} changed while its authenticated snapshot was read")
            return first
        finally:
            if named_descriptor is not None:
                os.close(named_descriptor)
            os.close(descriptor)
    finally:
        os.close(directory)


def read_owner_secret(target: pathlib.Path, expected_key_id: str) -> str:
    raw = read_authority_bytes(
        target,
        label="qualification secret",
        minimum=32,
        maximum=4096,
    )
    secret = raw.decode("utf-8").strip()
    if (
        len(secret) < 32
        or len(secret) > 4096
        or key_id(secret) != expected_key_id
    ):
        raise ValueError(
            "qualification secret differs from the independently configured key ID"
        )
    return secret


def parse_timestamp(value: object) -> datetime.datetime:
    if not isinstance(value, str) or not value.endswith("Z"):
        raise ValueError("timestamp is not canonical UTC milliseconds")
    parsed = datetime.datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("timestamp is not timezone-aware")
    canonical = parsed.astimezone(datetime.timezone.utc).isoformat(timespec="milliseconds")
    if canonical.replace("+00:00", "Z") != value:
        raise ValueError("timestamp is not canonical UTC milliseconds")
    return parsed


def archival_recovery_after_expiry(
    plan: dict,
    now: datetime.datetime | None = None,
) -> bool:
    observed = now or datetime.datetime.now(datetime.timezone.utc)
    if observed.tzinfo is None:
        raise ValueError("archival recovery time must carry a timezone")
    return observed.astimezone(datetime.timezone.utc) > parse_timestamp(plan.get("expiresAt"))


def content_identity_sha256(*values: str) -> str:
    encoded = "".join(f"{len(value)}:{value}\n" for value in values).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def command_identity_sha256(command: list[str]) -> str:
    return hashlib.sha256(b"".join(value.encode("utf-8") + b"\0" for value in command)).hexdigest()


def qualification_unit_name(kind: str, readable: str, identity: str) -> str:
    prefix = re.sub(r"[^A-Za-z0-9-]", "-", readable)[:40]
    unit = f"clos-phd-{kind}-{prefix}-{identity}"
    if not UNIT_NAME.fullmatch(unit):
        raise ValueError("derived qualification worker unit name is invalid")
    return unit


def exact_local_job_file_sha256(
    job_path: pathlib.Path,
    authenticated_job: dict,
) -> str:
    descriptor = os.open(
        job_path,
        os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_CLOEXEC", 0),
    )
    try:
        metadata = os.fstat(descriptor)
        with os.fdopen(os.dup(descriptor), "rb") as handle:
            raw = handle.read(64 * 1024 * 1024 + 1)
        if (
            not stat.S_ISREG(metadata.st_mode)
            or metadata.st_uid != os.geteuid()
            or metadata.st_gid != os.getegid()
            or stat.S_IMODE(metadata.st_mode) != 0o600
            or metadata.st_nlink != 1
            or len(raw) < 2
            or len(raw) > 64 * 1024 * 1024
            or json.loads(raw.decode("utf-8"), object_pairs_hook=reject_duplicate_object_keys)
            != authenticated_job
        ):
            raise ValueError("local archived job bytes or metadata differ from the authenticated plan")
        return hashlib.sha256(raw).hexdigest()
    finally:
        os.close(descriptor)


def derive_live_worker_specs(
    plan: dict,
    verification: dict,
    args: argparse.Namespace,
    signing_secret: str,
) -> dict[str, dict]:
    remote_job_root = pathlib.PurePosixPath(args.remote_job_root)
    remote_artifact_root = pathlib.PurePosixPath(args.remote_artifact_root)
    remote_checkout_root = pathlib.PurePosixPath(args.remote_checkout_root)
    remote_campaign_root = remote_job_root.parent
    local_campaign_root = pathlib.Path(args.state_file).parent
    if (
        remote_campaign_root.name != args.expected_campaign_id
        or remote_job_root != remote_campaign_root / "jobs"
        or remote_artifact_root != remote_campaign_root / "artifacts"
        or remote_checkout_root != remote_campaign_root / "checkout"
    ):
        raise ValueError("live-worker remote checkout, job, or terminal roots are not campaign-scoped")
    local_job_root = local_campaign_root / "jobs"
    deployment = plan.get("deployment")
    if (
        not isinstance(deployment, dict)
        or deployment.get("sourceCommit") != verification.get("sourceCommit")
        or deployment.get("sourceTree") != verification.get("sourceTree")
        or deployment.get("productTree") != args.expected_product_tree
        or deployment.get("runtimeSha256") != args.expected_runtime_sha256
        or deployment.get("closureSha256") != args.expected_closure_sha256
    ):
        raise ValueError("authenticated live-worker deployment identity is incomplete")

    specs: dict[str, dict] = {}
    for job in plan["jobs"]:
        job_id = job["jobId"]
        local_job_path = local_job_root / f"{job_id}.json"
        remote_job_path = str(remote_job_root / f"{job_id}.json")
        terminal_root = str(remote_artifact_root / job_id)
        checkout_root = str(remote_checkout_root)
        worker_command = [
            "/bin/bash",
            f"{checkout_root}/cortex-learning-os/scripts/remote-phd-qualification-worker.sh",
            job_id,
            verification["sourceCommit"],
            verification["sourceTree"],
            args.expected_product_tree,
            remote_job_path,
            terminal_root,
            exact_local_job_file_sha256(local_job_path, job),
            args.expected_plan_digest,
            args.expected_campaign_digest,
            args.expected_descriptor_set_sha256,
            args.expected_runtime_sha256,
            args.expected_closure_sha256,
            checkout_root,
        ]
        command_sha256 = command_identity_sha256(worker_command)
        binding_sha256 = content_identity_sha256(
            "worker",
            args.expected_plan_digest,
            args.expected_campaign_id,
            job_id,
            worker_command[8],
            command_sha256,
            checkout_root,
        )
        unsigned_spec = {
            "schemaVersion": LIVE_WORKER_SCHEMA,
            "jobId": job_id,
            "jobDigest": verification["jobDigests"][job_id],
            "jobPath": remote_job_path,
            "jobFileSha256": worker_command[8],
            "checkoutRoot": checkout_root,
            "terminalRoot": terminal_root,
            "terminalManifest": f"{terminal_root}/artifact-manifest.json",
            "planDigest": args.expected_plan_digest,
            "campaignDigest": args.expected_campaign_digest,
            "deploymentDigest": args.expected_deployment_digest,
            "descriptorSetSha256": args.expected_descriptor_set_sha256,
            "runtimeSha256": args.expected_runtime_sha256,
            "closureSha256": args.expected_closure_sha256,
            "unitName": qualification_unit_name("worker", job_id, binding_sha256),
            "bindingSha256": binding_sha256,
            "commandSha256": command_sha256,
            "expectedUser": "root",
            "expectedGroup": "root",
            "workingDirectory": f"{checkout_root}/cortex-learning-os",
            "workerCommand": worker_command,
            "recoveryCommand": [*worker_command, "reconcile-only"],
        }
        specs[job_id] = sign_record(unsigned_spec, signing_secret)
    return specs


def live_worker_set_sha256(specs: dict[str, dict]) -> str:
    ordered = [specs[job_id] for job_id in sorted(specs)]
    return hashlib.sha256(canonical_json(ordered).encode("utf-8")).hexdigest()


def remote_command(
    host: str,
    command: list[str],
) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["ssh", "-o", "BatchMode=yes", host, *command],
        check=False,
        capture_output=True,
        text=True,
    )


def authenticated_remote_worker_active(host: str, spec: dict) -> bool:
    active = remote_command(
        host,
        ["systemctl", "is-active", "--quiet", spec["unitName"]],
    )
    if active.returncode in {1, 3, 4}:
        return False
    if active.returncode != 0:
        raise ValueError("authenticated live-worker state probe failed")

    def property_value(name: str) -> str:
        observed = remote_command(
            host,
            ["systemctl", "show", spec["unitName"], f"--property={name}", "--value"],
        )
        if observed.returncode != 0:
            raise ValueError("authenticated live-worker property probe failed")
        return observed.stdout.strip()

    pid = property_value("MainPID")
    if (
        not pid.isdigit()
        or int(pid) < 1
        or property_value("User") != spec["expectedUser"]
        or property_value("Group") != spec["expectedGroup"]
        or property_value("WorkingDirectory") != spec["workingDirectory"]
        or property_value("Environment")
        != f"CLOS_UNIT_BINDING_SHA256={spec['bindingSha256']}"
    ):
        raise ValueError("authenticated live-worker unit identity changed")
    command_digest = remote_command(host, ["sha256sum", f"/proc/{pid}/cmdline"])
    working_directory = remote_command(host, ["readlink", "-f", f"/proc/{pid}/cwd"])
    if (
        command_digest.returncode != 0
        or command_digest.stdout.split(maxsplit=1)[0] != spec["commandSha256"]
        or working_directory.returncode != 0
        or working_directory.stdout.strip() != spec["workingDirectory"]
    ):
        raise ValueError("authenticated live-worker process identity changed")
    return True


def reconcile_after_live_worker(
    host: str,
    spec: dict,
    *,
    attempts: int = 720,
    sleep=time.sleep,
) -> bool:
    for _ in range(attempts):
        if authenticated_remote_worker_active(host, spec):
            sleep(5)
            continue
        recovery = remote_command(host, spec["recoveryCommand"])
        if recovery.returncode == 0:
            terminal = remote_command(host, ["test", "-f", spec["terminalManifest"]])
            if terminal.returncode != 0:
                raise ValueError("live-worker recovery reported publication without a terminal")
            return True
        if recovery.returncode == 8:
            sleep(5)
            continue
        if recovery.returncode == 7:
            return False
        raise ValueError("authenticated live-worker terminal reconciliation failed")
    raise ValueError("authenticated live-worker reconciliation timed out")


def expired_missing_terminal_failure(
    job_id: str,
    initial_terminal_job_ids: set[str],
    *,
    archival_after_expiry: bool,
    authenticated_live_owner: bool = False,
) -> dict | None:
    if (
        not archival_after_expiry
        or job_id in initial_terminal_job_ids
        or authenticated_live_owner
    ):
        return None
    return {
        "jobId": job_id,
        "reason": (
            "terminal artifact is missing after authenticated plan expiry; "
            "archival recovery cannot relaunch work and a new campaign is required"
        ),
    }


def canonical_runtime_validation(
    target: pathlib.Path,
    execution_identity: dict | None = None,
    checkout_root: pathlib.Path | str | None = None,
) -> tuple[bool, str]:
    if execution_identity is None or checkout_root is None:
        return True, ""
    validator = pathlib.Path(__file__).resolve().parent.parent / "src" / "validate-phd-worker-artifact.mjs"
    result = subprocess.run(
        [
            "/usr/bin/node",
            str(validator),
            str(target / "job.json"),
            str(target),
            "--checkout-root",
            str(checkout_root),
            "--plan-digest",
            execution_identity["planDigest"],
            "--campaign-digest",
            execution_identity["campaignDigest"],
            "--descriptor-set-sha256",
            execution_identity["descriptorSetSha256"],
            "--product-tree",
            execution_identity["productTree"],
            "--runtime-sha256",
            execution_identity["runtimeSha256"],
            "--closure-sha256",
            execution_identity["closureSha256"],
        ],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        reason = result.stderr.strip() or "canonical execution-evidence runtime rejected artifact"
        return False, reason
    return True, ""


def execution_interval(
    job: dict,
    started_at: object,
    completed_at: object,
    job_digest: str | None = None,
) -> tuple[dict, str]:
    interval = {
        "jobDigest": job_digest or canonical_digest(job),
        "notBefore": job.get("notBefore"),
        "startedAt": started_at,
        "completedAt": completed_at,
        "expiresAt": job.get("expiresAt"),
    }
    started = parse_timestamp(started_at)
    completed = parse_timestamp(completed_at)
    not_before = parse_timestamp(job.get("notBefore"))
    expires = parse_timestamp(job.get("expiresAt"))
    if started < not_before or completed < started or completed > expires:
        raise ValueError("execution interval is outside signed job lower bound or expiry")
    return interval, canonical_digest(interval)


def expected_execution_identity(verification: dict) -> dict:
    return {
        "planDigest": verification["planDigest"],
        "campaignDigest": verification["campaignDigest"],
        "descriptorSetSha256": verification["descriptorSetSha256"],
        "productTree": verification["productTree"],
        "runtimeSha256": verification["runtimeSha256"],
        "closureSha256": verification["closureSha256"],
    }


def mode_string(mode: int) -> str:
    return f"{stat.S_IMODE(mode):04o}"


def expected_directory_links(target: pathlib.Path) -> int:
    return 2 + sum(
        1 for entry in target.iterdir()
        if entry.is_dir() and not entry.is_symlink()
    )


def validate_terminal_metadata(
    target: pathlib.Path,
    manifest: dict,
    *,
    owner_uid: int = 0,
    owner_gid: int = 0,
) -> tuple[bool, str]:
    publication = manifest.get("publication")
    if (not isinstance(publication, dict)
            or set(publication) != {
                "schemaVersion", "publisherUid", "publisherGid", "rootMode",
                "fileMode", "directoryMode", "regularFileLinkCount",
                "rootLinkCount", "producerWritableTerminal", "noFollow",
                "exactMetadata",
            }
            or publication.get("schemaVersion")
            != "cortex.learning_os.phd_terminal_publication.v1"
            or publication.get("publisherUid") != owner_uid
            or publication.get("publisherGid") != owner_gid
            or publication.get("rootMode") != "0555"
            or publication.get("fileMode") != "0444"
            or publication.get("directoryMode") != "0555"
            or publication.get("regularFileLinkCount") != 1
            or publication.get("producerWritableTerminal") is not False
            or publication.get("noFollow") is not True
            or publication.get("exactMetadata") is not True):
        return False, "terminal publication policy is invalid"
    root_stat = target.lstat()
    if (target.is_symlink() or not target.is_dir()
            or root_stat.st_uid != owner_uid or root_stat.st_gid != owner_gid
            or mode_string(root_stat.st_mode) != publication["rootMode"]
            or root_stat.st_nlink != publication["rootLinkCount"]
            or root_stat.st_nlink != expected_directory_links(target)):
        return False, "terminal root ownership, mode, or link count is invalid"
    directory_records = {
        record.get("path"): record
        for record in manifest.get("directories", [])
        if isinstance(record, dict)
    }
    actual_directories: set[str] = set()
    actual_files: set[str] = set()
    for entry in sorted(target.rglob("*")):
        relative = entry.relative_to(target).as_posix()
        entry_stat = entry.lstat()
        if entry.is_symlink():
            return False, "terminal metadata contains a symlink"
        if entry.is_dir():
            actual_directories.add(relative)
            record = directory_records.get(relative)
            if (not isinstance(record, dict)
                    or set(record) != {
                        "path", "ownerUid", "ownerGid", "mode", "linkCount",
                    }
                    or record.get("ownerUid") != owner_uid
                    or record.get("ownerGid") != owner_gid
                    or record.get("mode") != publication["directoryMode"]
                    or record.get("linkCount") != expected_directory_links(entry)
                    or entry_stat.st_uid != owner_uid or entry_stat.st_gid != owner_gid
                    or mode_string(entry_stat.st_mode) != record.get("mode")
                    or entry_stat.st_nlink != record.get("linkCount")):
                return False, f"terminal directory metadata mismatch: {relative}"
        elif entry.is_file():
            actual_files.add(relative)
            if (entry_stat.st_uid != owner_uid or entry_stat.st_gid != owner_gid
                    or mode_string(entry_stat.st_mode) != publication["fileMode"]
                    or entry_stat.st_nlink != 1):
                return False, f"terminal file metadata mismatch: {relative}"
        else:
            return False, f"terminal metadata contains a special object: {relative}"
    expected_files = {
        record.get("path") for record in manifest.get("files", [])
        if isinstance(record, dict)
    } | {"artifact-manifest.json"}
    if (actual_directories != set(directory_records)
            or actual_files != expected_files):
        return False, "terminal metadata does not cover the exact recursive set"
    return True, ""


def validate_harvested(
    target: pathlib.Path,
    job: dict,
    execution_identity: dict | None = None,
    signing_secret: str | None = None,
    expected_job_digest: str | None = None,
    checkout_root: pathlib.Path | str | None = None,
    require_terminal_metadata: bool = False,
    terminal_owner_uid: int = 0,
    terminal_owner_gid: int = 0,
) -> tuple[bool, str]:
    try:
        if signing_secret is not None and not verify_control_signature(job, signing_secret):
            return False, "detached job control-plane signature mismatch"
        job_digest = expected_job_digest or canonical_digest(job)
        if not DIGEST.fullmatch(str(job_digest or "")):
            return False, "authenticated detached job digest is invalid"
        if target.is_symlink() or not target.is_dir():
            return False, "harvest target is not a regular directory"
        for path in target.rglob("*"):
            if path.is_symlink():
                return False, "harvest contains a symlink"
        summary_path = target / "worker-summary.json"
        if not summary_path.is_file() or summary_path.is_symlink():
            return False, "worker summary is missing or unsafe"
        summary = json.loads(summary_path.read_text(encoding="utf-8"))
        summary_keys = {
            "schemaVersion", "jobId", "campaignId", "jobDigest", "executor",
            "status", "notBefore", "startedAt", "completedAt", "expiresAt",
            "executionIntervalSha256", "timingProvenance", "outputSha256",
            "executionIdentity", "authority", "canonicalStateMutated",
            "truthBoundary",
        }
        if summary.get("status") == "failed":
            summary_keys.add("blocker")
        if (set(summary) != summary_keys
                or summary.get("schemaVersion") != "cortex.learning_os.phd_worker_summary.v2"):
            return False, "worker summary schema mismatch"
        if ((summary.get("status") == "failed"
             and not valid_worker_blocker(summary.get("blocker")))
                or (summary.get("status") != "failed" and "blocker" in summary)):
            return False, "worker summary status-dependent blocker is invalid"
        _, interval_digest = execution_interval(
            job,
            summary.get("startedAt"),
            summary.get("completedAt"),
            job_digest,
        )
        if (summary.get("jobId") != job["jobId"]
                or summary.get("campaignId") != job["campaignId"]
                or summary.get("jobDigest") != job_digest
                or summary.get("executor") != job.get("executor")
                or summary.get("status") not in {"candidate", "failed"}
                or summary.get("notBefore") != job.get("notBefore")
                or summary.get("expiresAt") != job.get("expiresAt")
                or summary.get("executionIntervalSha256") != interval_digest
                or summary.get("timingProvenance")
                != "worker_observed_awaiting_execution_attestation"
                or summary.get("authority") != "worker_evidence_only"
                or summary.get("canonicalStateMutated") is not False
                or (execution_identity is not None
                    and summary.get("executionIdentity") != execution_identity)):
            return False, "worker summary job, timing, or execution closure mismatch"
        manifest_path = target / "artifact-manifest.json"
        if not manifest_path.is_file() or manifest_path.is_symlink():
            return False, "candidate artifact manifest is missing or unsafe"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if set(manifest) != {
            "schemaVersion", "jobId", "campaignId", "jobDigest",
            "jobControlPlaneSignature", "deployment", "executor",
            "executionIdentity", "promptSha256", "status", "startedAt",
            "notBefore", "completedAt", "expiresAt", "executionIntervalSha256",
            "timingProvenance", "outputSha256", "publication", "directories",
            "files", "authority", "truthBoundary",
        }:
            return False, "candidate artifact manifest shape mismatch"
        if (manifest.get("schemaVersion") != "cortex.learning_os.phd_worker_manifest.v3"
                or manifest.get("jobId") != job["jobId"]
                or manifest.get("campaignId") != job["campaignId"]
                or manifest.get("jobDigest") != job_digest
                or manifest.get("jobControlPlaneSignature") != job.get("controlPlaneSignature")
                or manifest.get("deployment") != job["deployment"]
                or manifest.get("executor") != job.get("executor")
                or manifest.get("promptSha256") != job["promptSha256"]
                or manifest.get("status") != summary.get("status")
                or manifest.get("notBefore") != summary.get("notBefore")
                or manifest.get("startedAt") != summary.get("startedAt")
                or manifest.get("completedAt") != summary.get("completedAt")
                or manifest.get("expiresAt") != summary.get("expiresAt")
                or manifest.get("executionIntervalSha256") != interval_digest
                or manifest.get("timingProvenance") != summary.get("timingProvenance")
                or manifest.get("authority") != "worker_evidence_only"
                or manifest.get("outputSha256") != summary.get("outputSha256")
                or (execution_identity is not None
                    and manifest.get("executionIdentity") != execution_identity)):
            return False, "candidate artifact manifest binding mismatch"
        records = manifest.get("files")
        if not isinstance(records, list) or not records:
            return False, "candidate artifact manifest file list is incomplete"
        expected_paths = set()
        for record in records:
            if (not isinstance(record, dict)
                    or set(record) != {
                        "path", "bytes", "ownerUid", "ownerGid", "mode",
                        "linkCount", "sha256",
                    }
                    or not isinstance(record.get("bytes"), int)
                    or isinstance(record.get("bytes"), bool)
                    or record["bytes"] < 0
                    or record.get("ownerUid") != 0
                    or record.get("ownerGid") != 0
                    or record.get("mode") != "0444"
                    or record.get("linkCount") != 1
                    or not DIGEST.fullmatch(str(record.get("sha256") or ""))):
                return False, "candidate artifact manifest file record is invalid"
            relative = pathlib.PurePosixPath(str(record.get("path") or ""))
            if (relative.is_absolute() or ".." in relative.parts or not relative.parts
                    or relative.as_posix() in expected_paths):
                return False, "candidate artifact manifest contains an unsafe or duplicate path"
            file_path = target.joinpath(*relative.parts)
            if not file_path.is_file() or file_path.is_symlink():
                return False, "candidate artifact manifest names a missing or unsafe file"
            if (file_path.stat().st_size != record.get("bytes")
                    or sha256_file(file_path) != record.get("sha256")):
                return False, "candidate artifact file digest mismatch"
            expected_paths.add(relative.as_posix())
        actual_paths = {
            path.relative_to(target).as_posix()
            for path in target.rglob("*")
            if path.is_file() and path.name != "artifact-manifest.json"
        }
        if expected_paths != actual_paths:
            return False, "candidate artifact manifest is partial or has extra files"
        directory_records = manifest.get("directories")
        if (not isinstance(directory_records, list)
                or len({
                    record.get("path") for record in directory_records
                    if isinstance(record, dict)
                }) != len(directory_records)
                or any(
                    not isinstance(record, dict)
                    or set(record) != {
                        "path", "ownerUid", "ownerGid", "mode", "linkCount",
                    }
                    or not isinstance(record.get("path"), str)
                    or pathlib.PurePosixPath(record["path"]).is_absolute()
                    or ".." in pathlib.PurePosixPath(record["path"]).parts
                    or record.get("ownerUid") != 0
                    or record.get("ownerGid") != 0
                    or record.get("mode") != "0555"
                    or not isinstance(record.get("linkCount"), int)
                    or isinstance(record.get("linkCount"), bool)
                    or record["linkCount"] < 2
                    for record in directory_records
                )):
            return False, "candidate artifact directory metadata is invalid"
        actual_directories = {
            entry.relative_to(target).as_posix()
            for entry in target.rglob("*")
            if entry.is_dir() and not entry.is_symlink()
        }
        if actual_directories != {record["path"] for record in directory_records}:
            return False, "candidate artifact directory metadata is partial or extra"
        if require_terminal_metadata:
            metadata_valid, metadata_reason = validate_terminal_metadata(
                target,
                manifest,
                owner_uid=terminal_owner_uid,
                owner_gid=terminal_owner_gid,
            )
            if not metadata_valid:
                return False, metadata_reason
        job_record = json.loads((target / "job.json").read_text(encoding="utf-8"))
        if job_record != job:
            return False, "harvested job record was substituted"
        canonical_valid, canonical_reason = canonical_runtime_validation(
            target,
            execution_identity,
            checkout_root,
        )
        if not canonical_valid:
            return False, canonical_reason
        output_path = target / "output.json"
        if sha256_file(output_path) != summary.get("outputSha256"):
            return False, "candidate output digest mismatch"
        if summary.get("status") == "candidate":
            if job.get("executor", "model_no_tools") == "model_no_tools":
                call = json.loads((target / "model-call.json").read_text(encoding="utf-8"))
                raw_events = target / "raw-events.ndjson"
                raw_stderr = target / "stderr.raw"
                core = call.get("executionEvidenceCore")
                evidence_digest = call.get("executionEvidenceSha256")
                if (not isinstance(core, dict)
                        or core.get("schemaVersion") != "cortex.learning_os.execution_evidence_core.v1"
                        or evidence_digest != canonical_digest(core)
                        or call.get("attestation") is not None):
                    return False, "candidate canonical execution-evidence core is missing or detached"
                try:
                    prompt_bytes = base64.b64decode(job["promptBase64"], validate=True)
                    raw_records = {
                        record["name"]: record
                        for record in core["outputs"]["raw"]
                    }
                    file_records = {
                        record["path"]: record
                        for record in core["outputs"]["files"]
                    }
                except (KeyError, TypeError, ValueError):
                    return False, "candidate canonical execution-evidence byte records are invalid"
                approved_executable = job.get("deployment", {}).get("approvedModelExecutable")
                if approved_executable is not None:
                    requested_argv = core.get("command", {}).get("requestedArgv")
                    executed_argv = core.get("command", {}).get("executedArgv")
                    executable = core.get("command", {}).get("executable", {})
                    expected_args = call.get("args")
                    if (not isinstance(expected_args, list)
                            or requested_argv != [approved_executable.get("path"), *expected_args]
                            or executed_argv != ["/proc/self/fd/3", *expected_args]
                            or call.get("command") != approved_executable.get("path")
                            or executable.get("invoked") != approved_executable.get("path")
                            or executable.get("resolvedPath") != "/proc/self/fd/3"
                            or executable.get("bytes") != approved_executable.get("bytes")
                            or executable.get("sha256") != approved_executable.get("sha256")):
                        return False, "candidate approved executable identity or descriptor execution mismatch"
                elif job.get("deployment", {}).get("executionClosure", {}).get("immutable") is True:
                    return False, "candidate immutable deployment omits an approved executable"
                if set(call) != {
                        "schemaVersion", "jobId", "jobDigest", "role",
                        "command", "args",
                        "plannedSessionId", "providerRequestId", "providerSessionId",
                        "provider", "model", "thinking", "sandbox", "toolsAllowed",
                        "toolsUsed", "usage", "positiveUsage", "isolatedDirectory",
                        "exactPromptBytes", "promptSha256", "outputSha256",
                        "rawEventLedgerSha256", "executionIdentity", "startedAt",
                        "notBefore", "completedAt", "expiresAt", "executionIntervalSha256",
                        "exitCode", "signal", "error", "postprocessError",
                        "evidenceError", "stderrSha256", "executionEvidenceCore",
                        "executionEvidenceSha256", "attestation",
                        "provenanceStatus",
                }:
                    return False, "candidate model call shape mismatch"
                if (call.get("schemaVersion") != "cortex.learning_os.phd_worker_call.v2"
                        or call.get("jobId") != job["jobId"]
                        or call.get("jobDigest") != job_digest
                        or call.get("promptSha256") != job["promptSha256"]
                        or call.get("outputSha256") != sha256_file(output_path)
                        or call.get("notBefore") != job.get("notBefore")
                        or call.get("startedAt") != summary.get("startedAt")
                        or call.get("completedAt") != summary.get("completedAt")
                        or call.get("expiresAt") != job.get("expiresAt")
                        or call.get("executionIntervalSha256") != interval_digest
                        or (execution_identity is not None
                            and call.get("executionIdentity") != execution_identity)
                        or call.get("rawEventLedgerSha256") != sha256_file(raw_events)
                        or call.get("stderrSha256") != sha256_file(raw_stderr)
                        or core.get("bindings", {}).get("jobId") != job["jobId"]
                        or core.get("bindings", {}).get("jobSha256") != canonical_digest(job)
                        or core.get("bindings", {}).get("campaignId") != job["campaignId"]
                        or core.get("bindings", {}).get("campaignSha256") != job["campaignDigest"]
                        or not byte_record_matches(core.get("input"), prompt_bytes)
                        or set(raw_records) != {"stdout", "stderr"}
                        or not byte_record_matches(raw_records["stdout"], raw_events.read_bytes())
                        or not byte_record_matches(raw_records["stderr"], raw_stderr.read_bytes())
                        or set(file_records) != {"output.json"}
                        or not byte_record_matches(file_records["output.json"], output_path.read_bytes())):
                    return False, "candidate raw output or event-ledger binding mismatch"
            else:
                execution = json.loads((target / "execution-record.json").read_text(encoding="utf-8"))
                if set(execution) != {
                        "schemaVersion", "jobId", "jobDigest", "role", "executor",
                        "sessionId", "descriptorSha256", "idempotencyKey",
                        "executionIdentity", "dependencyBindings", "notBefore", "startedAt",
                        "completedAt", "expiresAt", "executionIntervalSha256",
                        "outputSha256", "authority", "canonicalStateMutated",
                }:
                    return False, "inert execution shape mismatch"
                if (execution.get("schemaVersion") != "cortex.learning_os.phd_inert_execution.v2"
                        or execution.get("jobId") != job["jobId"]
                        or execution.get("jobDigest") != job_digest
                        or execution.get("executor") != job.get("executor")
                        or execution.get("descriptorSha256") != job.get("descriptorSha256")
                        or execution.get("idempotencyKey") != job.get("idempotencyKey")
                        or execution.get("outputSha256") != sha256_file(output_path)
                        or execution.get("notBefore") != job.get("notBefore")
                        or execution.get("startedAt") != summary.get("startedAt")
                        or execution.get("completedAt") != summary.get("completedAt")
                        or execution.get("expiresAt") != job.get("expiresAt")
                        or execution.get("executionIntervalSha256") != interval_digest
                        or (execution_identity is not None
                            and execution.get("executionIdentity") != execution_identity)
                        or execution.get("authority") != "worker_evidence_only"
                        or execution.get("canonicalStateMutated") is not False):
                    return False, "inert execution identity or output binding mismatch"
                if job.get("executor") == "frozen_research_reproduction":
                    request = json.loads(
                        (target / "reproduction-authority-request.json").read_text(encoding="utf-8")
                    )
                    core = request.get("executionEvidenceCore")
                    evidence_digest = request.get("executionEvidenceSha256")
                    try:
                        raw_records = {
                            record["name"]: record
                            for record in core["outputs"]["raw"]
                        }
                        file_records = {
                            record["path"]: record
                            for record in core["outputs"]["files"]
                        }
                    except (KeyError, TypeError):
                        return False, "reproduction canonical execution-evidence records are invalid"
                    source_bytes = json.dumps(
                        job["task"]["sourceBundle"],
                        ensure_ascii=False,
                        separators=(",", ":"),
                        sort_keys=True,
                    ).encode("utf-8")
                    if (request.get("status") != "ready_for_independent_authority"
                            or not isinstance(core, dict)
                            or evidence_digest != canonical_digest(core)
                            or request.get("requestedAttestationPayload", {}).get(
                                "executionEvidenceSha256"
                            ) != evidence_digest
                            or request.get("requestedAttestationPayload", {}).get(
                                "executionEvidenceCore"
                            ) != core
                            or core.get("bindings", {}).get("jobId") != job["jobId"]
                            or core.get("bindings", {}).get("jobSha256") != canonical_digest(job)
                            or core.get("bindings", {}).get("campaignId") != job["campaignId"]
                            or core.get("bindings", {}).get("campaignSha256") != job["campaignDigest"]
                            or core.get("bindings", {}).get("sourceSha256")
                            != job["task"]["sourceBundleSha256"]
                            or not byte_record_matches(core.get("input"), source_bytes)
                            or set(raw_records) != {"stdout", "stderr"}
                            or not byte_record_matches(
                                raw_records["stdout"], (target / "stdout.raw").read_bytes()
                            )
                            or not byte_record_matches(
                                raw_records["stderr"], (target / "stderr.raw").read_bytes()
                            )
                            or set(file_records) != {
                                record["path"] for record in request.get("outputs", [])
                            }
                            or any(
                                not byte_record_matches(
                                    record,
                                    (target / "outputs").joinpath(*pathlib.PurePosixPath(
                                        output_path
                                    ).parts).read_bytes(),
                                )
                                for output_path, record in file_records.items()
                            )):
                        return False, "reproduction canonical execution-evidence core is detached"
        return True, ""
    except (OSError, ValueError, TypeError, KeyError, json.JSONDecodeError) as error:
        return False, f"candidate artifact validation failed: {error}"


def harvest_receipt(
    target: pathlib.Path,
    job: dict,
    execution_identity: dict,
    signing_secret: str,
    expected_job_digest: str,
    checkout_root: pathlib.Path | str | None = None,
    require_terminal_metadata: bool = False,
) -> dict:
    if execution_identity is None or checkout_root is None:
        raise ValueError(
            "harvest receipt requires the shared canonical terminal contract "
            "and exact frozen checkout"
        )
    valid, reason = validate_harvested(
        target,
        job,
        execution_identity,
        signing_secret,
        expected_job_digest,
        checkout_root,
        require_terminal_metadata,
    )
    if not valid:
        raise ValueError(reason)
    summary = json.loads((target / "worker-summary.json").read_text(encoding="utf-8"))
    if summary.get("status") != "candidate":
        raise ValueError("failed worker artifact cannot receive a candidate harvest receipt")
    return sign_record({
        "schemaVersion": "cortex.learning_os.phd_harvest_receipt.v1",
        "jobId": job["jobId"],
        "campaignId": job["campaignId"],
        "jobDigest": expected_job_digest,
        "descriptorSha256": job["descriptorSha256"],
        "executor": job["executor"],
        "executionIdentity": execution_identity,
        "notBefore": job["notBefore"],
        "startedAt": summary["startedAt"],
        "completedAt": summary["completedAt"],
        "expiresAt": summary["expiresAt"],
        "executionIntervalSha256": summary["executionIntervalSha256"],
        "artifactManifestSha256": sha256_file(target / "artifact-manifest.json"),
        "status": "candidate_authenticated_for_independent_replay",
        "providerTimeAuthority": False,
        "canonicalStateAuthority": False,
        "truthBoundary": (
            "Control-plane HMAC authenticates the exact plan/closure-bound harvested "
            "interval and manifest only; provider execution attestation remains required."
        ),
    }, signing_secret)


def staging_names(job_id: str) -> tuple[str, str]:
    return f"{job_id}.stage", f"{job_id}.journal.json"


def staging_journal(
    *,
    plan_digest: str,
    job: dict,
    job_digest: str,
    status: str,
    signing_secret: str,
) -> dict:
    if status not in {"copying", "validated", "published"}:
        raise ValueError("invalid local harvest staging phase")
    return sign_record({
        "schemaVersion": STAGING_JOURNAL_SCHEMA,
        "planDigest": plan_digest,
        "campaignId": job["campaignId"],
        "jobId": job["jobId"],
        "jobDigest": job_digest,
        "descriptorSha256": job["descriptorSha256"],
        "idempotencyKey": job["idempotencyKey"],
        "status": status,
        "truthBoundary": (
            "This root-protected journal binds resumable copy and publication only; "
            "it is not execution or qualification evidence."
        ),
    }, signing_secret)


def valid_staging_journal(
    journal: object,
    *,
    plan_digest: str,
    job: dict,
    job_digest: str,
    signing_secret: str,
) -> bool:
    return (
        isinstance(journal, dict)
        and set(journal) == {
            "schemaVersion", "planDigest", "campaignId", "jobId", "jobDigest",
            "descriptorSha256", "idempotencyKey", "status", "truthBoundary",
            "controlPlaneSignature",
        }
        and journal.get("schemaVersion") == STAGING_JOURNAL_SCHEMA
        and journal.get("planDigest") == plan_digest
        and journal.get("campaignId") == job.get("campaignId")
        and journal.get("jobId") == job.get("jobId")
        and journal.get("jobDigest") == job_digest
        and journal.get("descriptorSha256") == job.get("descriptorSha256")
        and journal.get("idempotencyKey") == job.get("idempotencyKey")
        and journal.get("status") in {"copying", "validated", "published"}
        and verify_control_signature(journal, signing_secret)
    )


def quarantine_remnant(
    target: pathlib.Path,
    quarantine_root: pathlib.Path,
    label: str,
) -> pathlib.Path:
    quarantine_root.mkdir(parents=True, exist_ok=True)
    destination = quarantine_root / (
        f"{label}.{datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')}."
        f"{os.getpid()}.{uuid.uuid4().hex}"
    )
    os.replace(target, destination)
    fsync_directory(quarantine_root)
    fsync_directory(target.parent)
    return destination


def reconcile_staging_root(
    staging_root: pathlib.Path,
    quarantine_root: pathlib.Path,
    jobs_by_id: dict[str, dict],
) -> None:
    expected = set()
    for job_id in jobs_by_id:
        expected.update(staging_names(job_id))
    for entry in list(staging_root.iterdir()):
        if entry.name not in expected:
            quarantine_remnant(entry, quarantine_root, "unknown")


def adopt_staged_terminal(
    *,
    stage: pathlib.Path,
    journal_path: pathlib.Path,
    target: pathlib.Path,
    quarantine_root: pathlib.Path,
    plan_digest: str,
    job: dict,
    job_digest: str,
    execution_identity: dict,
    signing_secret: str,
    checkout_root: pathlib.Path | str | None,
    require_terminal_metadata: bool = False,
    crash_injector=None,
) -> tuple[bool, str]:
    if not stage.exists():
        if journal_path.exists():
            try:
                journal = json.loads(journal_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                journal = None
            journal_valid = valid_staging_journal(
                journal,
                plan_digest=plan_digest,
                job=job,
                job_digest=job_digest,
                signing_secret=signing_secret,
            )
            if (
                journal_valid
                and journal.get("status") in {"validated", "published"}
                and target.exists()
            ):
                target_valid, target_reason = validate_harvested(
                    target,
                    job,
                    execution_identity,
                    signing_secret,
                    job_digest,
                    checkout_root,
                    require_terminal_metadata,
                )
                if not target_valid:
                    return (
                        False,
                        "published terminal differs from authenticated job: "
                        f"{target_reason}",
                    )
                fsync_tree(target)
                fsync_directory(target.parent)
                fsync_directory(journal_path.parent)
                if journal.get("status") != "published":
                    atomic_json(journal_path, staging_journal(
                        plan_digest=plan_digest,
                        job=job,
                        job_digest=job_digest,
                        status="published",
                        signing_secret=signing_secret,
                    ))
                return True, ""
            quarantine_remnant(
                journal_path,
                quarantine_root,
                f"{job['jobId']}.orphan-journal",
            )
        return False, ""
    try:
        journal = json.loads(journal_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        journal = None
    valid, reason = validate_harvested(
        stage,
        job,
        execution_identity,
        signing_secret,
        job_digest,
        checkout_root,
        require_terminal_metadata,
    )
    if not valid_staging_journal(
        journal,
        plan_digest=plan_digest,
        job=job,
        job_digest=job_digest,
        signing_secret=signing_secret,
    ) or not valid:
        quarantine_remnant(stage, quarantine_root, f"{job['jobId']}.mismatch")
        if journal_path.exists():
            quarantine_remnant(
                journal_path,
                quarantine_root,
                f"{job['jobId']}.mismatch-journal",
            )
        return False, ""
    if target.exists():
        target_valid, target_reason = validate_harvested(
            target,
            job,
            execution_identity,
            signing_secret,
            job_digest,
            checkout_root,
            require_terminal_metadata,
        )
        if not target_valid:
            return False, f"published terminal differs from authenticated job: {target_reason}"
        quarantine_remnant(stage, quarantine_root, f"{job['jobId']}.duplicate")
    else:
        fsync_tree(stage)
        atomic_json(journal_path, staging_journal(
            plan_digest=plan_digest,
            job=job,
            job_digest=job_digest,
            status="validated",
            signing_secret=signing_secret,
        ))
        if crash_injector is not None:
            crash_injector("after_staging_validated_journal")
        os.replace(stage, target)
        fsync_directory(target.parent)
        fsync_directory(journal_path.parent)
        if crash_injector is not None:
            crash_injector("after_staging_target_replace")
    atomic_json(journal_path, staging_journal(
        plan_digest=plan_digest,
        job=job,
        job_digest=job_digest,
        status="published",
        signing_secret=signing_secret,
    ))
    if crash_injector is not None:
        crash_injector("after_staging_published_journal")
    return True, ""


def verify_authenticated_plan(args: argparse.Namespace) -> tuple[dict, dict]:
    plan_path = pathlib.Path(args.jobs)
    secret_path = pathlib.Path(args.secret)
    command = [
        "/usr/bin/node",
        args.verifier,
        "verify-harvest-checkout",
        "--plan",
        str(plan_path),
        "--secret",
        str(secret_path),
        "--expected-plan-digest",
        args.expected_plan_digest,
        "--expected-subject-id",
        args.expected_subject_id,
        "--expected-campaign-id",
        args.expected_campaign_id,
        "--expected-campaign-digest",
        args.expected_campaign_digest,
        "--expected-deployment-digest",
        args.expected_deployment_digest,
        "--expected-key-id",
        args.expected_key_id,
        "--expected-descriptor-set-sha256",
        args.expected_descriptor_set_sha256,
        "--expected-job-count",
        str(args.expected_job_count),
        "--expected-job-set-sha256",
        args.expected_job_set_sha256,
        "--checkout-root",
        args.checkout_root,
    ]
    result = subprocess.run(command, check=False, capture_output=True, text=True)
    if result.returncode != 0:
        raise ValueError("authenticated v2 qualification plan verification failed")
    verification = json.loads(result.stdout)
    plan = verification.pop("authenticatedPlan", None)
    if not isinstance(plan, dict):
        raise ValueError("authenticated verifier did not return its exact plan snapshot")
    expected_fields = {
        "planDigest": args.expected_plan_digest,
        "subjectId": args.expected_subject_id,
        "campaignId": args.expected_campaign_id,
        "campaignDigest": args.expected_campaign_digest,
        "deploymentDigest": args.expected_deployment_digest,
        "descriptorSetSha256": args.expected_descriptor_set_sha256,
        "jobCount": args.expected_job_count,
        "jobSetSha256": args.expected_job_set_sha256,
        "productTree": args.expected_product_tree,
        "runtimeSha256": args.expected_runtime_sha256,
        "closureSha256": args.expected_closure_sha256,
    }
    if any(verification.get(key) != expected for key, expected in expected_fields.items()):
        raise ValueError("authenticated plan differs from expected campaign, deployment, job, or closure identity")
    if canonical_digest(plan) != args.expected_plan_digest:
        raise ValueError("protected plan snapshot changed after authentication")
    job_ids = [job.get("jobId") for job in plan.get("jobs", [])]
    if (plan.get("schemaVersion") != "cortex.learning_os.phd_detached_job_plan.v2"
            or len(job_ids) != args.expected_job_count
            or job_ids != verification.get("jobIds")
            or len(set(job_ids)) != len(job_ids)
            or any(not isinstance(job_id, str) or not IDENTIFIER.fullmatch(job_id)
                   for job_id in job_ids)):
        raise ValueError("authenticated plan exact job set mismatch")
    return plan, verification


def remote_entries(host: str, root: str, entry_type: str | None = None) -> set[str]:
    type_arguments = [] if entry_type is None else ["-type", entry_type]
    result = subprocess.run(
        [
            "ssh",
            "-o",
            "BatchMode=yes",
            host,
            "find",
            root,
            "-mindepth",
            "1",
            "-maxdepth",
            "1",
            *type_arguments,
            "-printf",
            "%f\n",
        ],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise ValueError("remote exact-set enumeration failed")
    entries = result.stdout.splitlines()
    if len(entries) != len(set(entries)):
        raise ValueError("remote exact-set enumeration is duplicate")
    return set(entries)


def validate_remote_exact_sets(
    expected_job_ids: set[str],
    job_entries: set[str],
    regular_job_entries: set[str],
    terminal_entries: set[str],
    terminal_directories: set[str],
    *,
    require_complete_terminals: bool,
) -> None:
    expected_job_files = {f"{job_id}.json" for job_id in expected_job_ids}
    if job_entries != expected_job_files or regular_job_entries != expected_job_files:
        raise ValueError("remote job set is partial, duplicate, stale, injected, missing, or extra")
    if terminal_entries != terminal_directories:
        raise ValueError("remote terminal set contains a non-directory, duplicate, or substituted entry")
    if require_complete_terminals:
        if terminal_entries != expected_job_ids:
            raise ValueError("remote terminal set is partial, duplicate, stale, injected, missing, or extra")
    elif not terminal_entries.issubset(expected_job_ids):
        raise ValueError("remote terminal set contains a stale, injected, duplicate, or extra entry")


def state_payload(
    args: argparse.Namespace,
    *,
    status: str,
    artifact_root: pathlib.Path,
    failures: list[dict],
    observed: int,
    succeeded: int,
    failed: int,
    receipts: list[dict],
    truth_boundary: str,
) -> dict:
    return {
        "schemaVersion": HARVEST_STATE_SCHEMA,
        "status": status,
        "planDigest": args.expected_plan_digest,
        "subjectId": args.expected_subject_id,
        "campaignId": args.expected_campaign_id,
        "campaignDigest": args.expected_campaign_digest,
        "deploymentDigest": args.expected_deployment_digest,
        "descriptorSetSha256": args.expected_descriptor_set_sha256,
        "jobSetSha256": args.expected_job_set_sha256,
        "productTree": args.expected_product_tree,
        "runtimeSha256": args.expected_runtime_sha256,
        "closureSha256": args.expected_closure_sha256,
        "liveWorkerSetSha256": getattr(
            args,
            "live_worker_set_sha256",
            hashlib.sha256(canonical_json([]).encode("utf-8")).hexdigest(),
        ),
        "expectedJobCount": args.expected_job_count,
        "observedJobCount": observed,
        "succeededJobCount": succeeded,
        "failedJobCount": failed,
        "failures": failures,
        "jobReceipts": receipts,
        "planSnapshotPath": str(pathlib.Path(args.jobs).resolve()),
        "qualificationSecretPath": str(pathlib.Path(args.secret).resolve()),
        "artifactRoot": str(artifact_root),
        "canonicalStateMutated": False,
        "updatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z"),
        "truthBoundary": truth_boundary,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--jobs", required=True)
    parser.add_argument("--secret", required=True)
    parser.add_argument("--verifier", required=True)
    parser.add_argument("--checkout-root", required=True)
    parser.add_argument("--expected-plan-digest", required=True)
    parser.add_argument("--expected-subject-id", required=True)
    parser.add_argument("--expected-campaign-id", required=True)
    parser.add_argument("--expected-campaign-digest", required=True)
    parser.add_argument("--expected-deployment-digest", required=True)
    parser.add_argument("--expected-key-id", required=True)
    parser.add_argument("--expected-descriptor-set-sha256", required=True)
    parser.add_argument("--expected-job-count", required=True, type=int)
    parser.add_argument("--expected-job-set-sha256", required=True)
    parser.add_argument("--expected-product-tree", required=True)
    parser.add_argument("--expected-runtime-sha256", required=True)
    parser.add_argument("--expected-closure-sha256", required=True)
    parser.add_argument("--ssh-host", required=True)
    parser.add_argument("--remote-checkout-root", required=True)
    parser.add_argument("--remote-job-root", required=True)
    parser.add_argument("--remote-artifact-root", required=True)
    parser.add_argument("--local-artifact-root", required=True)
    parser.add_argument("--local-staging-root", required=True)
    parser.add_argument("--local-quarantine-root", required=True)
    parser.add_argument("--state-file", required=True)
    parser.add_argument("--campaign-lock", required=True)
    return parser.parse_args()


def validate_arguments(args: argparse.Namespace) -> None:
    for value in (
        args.expected_plan_digest,
        args.expected_campaign_digest,
        args.expected_deployment_digest,
        args.expected_descriptor_set_sha256,
        args.expected_job_set_sha256,
        args.expected_runtime_sha256,
        args.expected_closure_sha256,
    ):
        if not DIGEST.fullmatch(value):
            raise ValueError("invalid expected authenticated digest")
    if not COMMIT.fullmatch(args.expected_product_tree):
        raise ValueError("invalid expected product tree")
    if (
        not IDENTIFIER.fullmatch(args.expected_subject_id)
        or not IDENTIFIER.fullmatch(args.expected_campaign_id)
        or not KEY_ID.fullmatch(args.expected_key_id)
    ):
        raise ValueError("invalid expected subject, campaign, or key identity")
    if args.expected_job_count < 1 or args.expected_job_count > 64:
        raise ValueError("invalid expected job count")
    if not SAFE_HOST.fullmatch(args.ssh_host):
        raise ValueError("unsafe SSH host")
    for value in (
        args.jobs,
        args.secret,
        args.verifier,
        args.checkout_root,
        args.remote_checkout_root,
        args.remote_job_root,
        args.remote_artifact_root,
        args.local_artifact_root,
        args.local_staging_root,
        args.local_quarantine_root,
        args.state_file,
        args.campaign_lock,
    ):
        if not SAFE_PATH.fullmatch(value):
            raise ValueError("unsafe qualification harvest path")
    state_file = pathlib.Path(args.state_file)
    campaign_lock = pathlib.Path(args.campaign_lock)
    campaign_root = state_file.parent
    if (
        state_file.name != "state.json"
        or campaign_lock.name != HARVEST_LOCK_NAME
        or campaign_root != campaign_lock.parent
        or campaign_root.name != args.expected_campaign_id
        or pathlib.Path(args.jobs) != campaign_root / "plan.v2.json"
        or pathlib.Path(args.local_artifact_root) != campaign_root / "artifacts"
        or pathlib.Path(args.local_staging_root) != campaign_root / "harvest-staging"
        or pathlib.Path(args.local_quarantine_root)
        != campaign_root / "harvest-quarantine"
    ):
        raise ValueError("qualification harvest mutable namespaces are not campaign-scoped")


def harvest_under_lock(
    args: argparse.Namespace,
    signing_secret: str,
    initial_state_sha256: str | None,
) -> int:
    local_root = pathlib.Path(args.local_artifact_root).resolve()
    staging_root = pathlib.Path(args.local_staging_root).resolve()
    quarantine_root = pathlib.Path(args.local_quarantine_root).resolve()
    state_file = pathlib.Path(args.state_file)
    try:
        args.live_worker_set_sha256 = hashlib.sha256(
            canonical_json([]).encode("utf-8")
        ).hexdigest()
        if (
            len({local_root, staging_root, quarantine_root}) != 3
            or local_root in staging_root.parents
            or local_root in quarantine_root.parents
            or staging_root in local_root.parents
            or quarantine_root in local_root.parents
        ):
            raise ValueError(
                "staging and quarantine roots must be distinct siblings outside the exact artifact root"
            )
        ensure_owner_protected_directory(local_root, "local artifact root")
        ensure_owner_protected_directory(staging_root, "local staging root")
        ensure_owner_protected_directory(quarantine_root, "local quarantine root")
        for protected_root in (local_root, staging_root, quarantine_root):
            fsync_directory(protected_root)
            fsync_directory(protected_root.parent)
        plan, verification = verify_authenticated_plan(args)
    except (OSError, ValueError, TypeError, KeyError, json.JSONDecodeError) as error:
        failure_state = state_payload(
            args,
            status="failed",
            artifact_root=local_root,
            failures=[{"jobId": None, "reason": str(error)}],
            observed=0,
            succeeded=0,
            failed=max(0, args.expected_job_count),
            receipts=[],
            truth_boundary="Harvest did not authenticate the exact frozen plan; no terminal evidence is accepted.",
        )
        try:
            disposition, _ = publish_harvest_state(
                state_file,
                failure_state,
                expected_sha256=initial_state_sha256,
                args=args,
                signing_secret=signing_secret,
            )
            if disposition == "adopted_ready":
                return 0
        except (OSError, ValueError):
            pass
        return 4

    execution_identity = expected_execution_identity(verification)
    expected_job_ids = {job["jobId"] for job in plan["jobs"]}
    jobs_by_id = {job["jobId"]: job for job in plan["jobs"]}
    expected_job_digests = verification["jobDigests"]
    archival_after_expiry = archival_recovery_after_expiry(plan)
    live_worker_spec_error = None
    try:
        derived_specs = derive_live_worker_specs(
            plan,
            verification,
            args,
            signing_secret,
        )
        args.live_worker_set_sha256 = live_worker_set_sha256(derived_specs)
        live_worker_specs = derived_specs if archival_after_expiry else {}
    except (
        OSError,
        ValueError,
        TypeError,
        KeyError,
        UnicodeDecodeError,
        json.JSONDecodeError,
    ) as error:
        live_worker_specs = {}
        live_worker_spec_error = str(error)
    disposition, running_state_sha256 = publish_harvest_state(
        state_file,
        state_payload(
            args,
            status="running",
            artifact_root=local_root,
            failures=[],
            observed=0,
            succeeded=0,
            failed=0,
            receipts=[],
            truth_boundary="Authenticated detached harvesting is waiting for the exact terminal worker set.",
        ),
        expected_sha256=initial_state_sha256,
        args=args,
        signing_secret=signing_secret,
    )
    if disposition == "adopted_ready":
        return 0

    failures: list[dict] = []
    if live_worker_spec_error is not None:
        failures.append({"jobId": None, "reason": live_worker_spec_error})
    receipts: list[dict] = []
    succeeded_ids: set[str] = set()
    observed_ids: set[str] = set()
    try:
        initial_artifacts = remote_entries(args.ssh_host, args.remote_artifact_root)
        initial_directories = remote_entries(args.ssh_host, args.remote_artifact_root, "d")
        validate_remote_exact_sets(
            expected_job_ids,
            remote_entries(args.ssh_host, args.remote_job_root),
            remote_entries(args.ssh_host, args.remote_job_root, "f"),
            initial_artifacts,
            initial_directories,
            require_complete_terminals=False,
        )
        local_entries = {entry.name for entry in local_root.iterdir()}
        if not local_entries.issubset(expected_job_ids):
            raise ValueError("local terminal set contains a stale, injected, duplicate, or extra entry")
        reconcile_staging_root(staging_root, quarantine_root, jobs_by_id)
    except (OSError, ValueError) as error:
        failures.append({"jobId": None, "reason": str(error)})

    if not failures:
        for job in plan["jobs"]:
            job_id = job["jobId"]
            remote = f"{args.ssh_host}:{args.remote_artifact_root}/{job_id}/"
            target = local_root / job_id
            stage_name, journal_name = staging_names(job_id)
            stage = staging_root / stage_name
            journal_path = staging_root / journal_name
            summary_path = target / "worker-summary.json"
            if summary_path.exists():
                valid, reason = validate_harvested(
                    target,
                    job,
                    execution_identity,
                    signing_secret,
                    expected_job_digests[job_id],
                    args.checkout_root,
                    True,
                )
                if not valid:
                    failures.append({"jobId": job_id, "reason": f"stale local terminal evidence: {reason}"})
                    continue
                if stage.exists():
                    _, reason = adopt_staged_terminal(
                        stage=stage,
                        journal_path=journal_path,
                        target=target,
                        quarantine_root=quarantine_root,
                        plan_digest=args.expected_plan_digest,
                        job=job,
                        job_digest=expected_job_digests[job_id],
                        execution_identity=execution_identity,
                        signing_secret=signing_secret,
                        checkout_root=args.checkout_root,
                        require_terminal_metadata=True,
                    )
                    if reason:
                        failures.append({"jobId": job_id, "reason": reason})
                        continue
                if journal_path.exists():
                    try:
                        journal = json.loads(journal_path.read_text(encoding="utf-8"))
                    except (OSError, json.JSONDecodeError):
                        journal = None
                    if valid_staging_journal(
                        journal,
                        plan_digest=args.expected_plan_digest,
                        job=job,
                        job_digest=expected_job_digests[job_id],
                        signing_secret=signing_secret,
                    ):
                        atomic_json(journal_path, staging_journal(
                            plan_digest=args.expected_plan_digest,
                            job=job,
                            job_digest=expected_job_digests[job_id],
                            status="published",
                            signing_secret=signing_secret,
                        ))
                    else:
                        quarantine_remnant(
                            journal_path,
                            quarantine_root,
                            f"{job_id}.mismatch-journal",
                        )
                fsync_tree(target)
                fsync_directory(local_root)
                summary = json.loads(summary_path.read_text(encoding="utf-8"))
                observed_ids.add(job_id)
                if summary.get("status") == "candidate":
                    succeeded_ids.add(job_id)
                    receipts.append(harvest_receipt(
                        target,
                        job,
                        execution_identity,
                        signing_secret,
                        expected_job_digests[job_id],
                        args.checkout_root,
                        True,
                    ))
                else:
                    failures.append({"jobId": job_id, "reason": "worker reported failed"})
                continue
            adopted, reason = adopt_staged_terminal(
                stage=stage,
                journal_path=journal_path,
                target=target,
                quarantine_root=quarantine_root,
                plan_digest=args.expected_plan_digest,
                job=job,
                job_digest=expected_job_digests[job_id],
                execution_identity=execution_identity,
                signing_secret=signing_secret,
                checkout_root=args.checkout_root,
                require_terminal_metadata=True,
            )
            if reason:
                failures.append({"jobId": job_id, "reason": reason})
                continue
            if adopted:
                summary = json.loads((target / "worker-summary.json").read_text(encoding="utf-8"))
                observed_ids.add(job_id)
                if summary.get("status") == "candidate":
                    succeeded_ids.add(job_id)
                    receipts.append(harvest_receipt(
                        target,
                        job,
                        execution_identity,
                        signing_secret,
                        expected_job_digests[job_id],
                        args.checkout_root,
                        True,
                    ))
                else:
                    failures.append({"jobId": job_id, "reason": "worker reported failed"})
                continue
            live_worker_spec = live_worker_specs.get(job_id)
            if live_worker_spec is not None:
                try:
                    recovered = reconcile_after_live_worker(
                        args.ssh_host,
                        live_worker_spec,
                    )
                except ValueError as error:
                    failures.append({"jobId": job_id, "reason": str(error)})
                    continue
                if not recovered:
                    failures.append(expired_missing_terminal_failure(
                        job_id,
                        initial_artifacts,
                        archival_after_expiry=archival_after_expiry,
                        authenticated_live_owner=False,
                    ) or {
                        "jobId": job_id,
                        "reason": "authenticated live worker ended without recoverable terminal evidence",
                    })
                    continue
            expiry_failure = expired_missing_terminal_failure(
                job_id,
                initial_artifacts,
                archival_after_expiry=archival_after_expiry,
                authenticated_live_owner=live_worker_spec is not None,
            )
            if expiry_failure is not None:
                failures.append(expiry_failure)
                continue
            remote_manifest = f"{args.remote_artifact_root}/{job_id}/artifact-manifest.json"
            terminal = False
            for _ in range(720):
                probe = subprocess.run(
                    ["ssh", "-o", "BatchMode=yes", args.ssh_host, "test", "-f", remote_manifest],
                    check=False,
                    capture_output=True,
                )
                if probe.returncode == 0:
                    terminal = True
                    break
                time.sleep(5)
            if not terminal:
                failures.append({"jobId": job_id, "reason": "terminal wait timed out"})
                continue
            stage.mkdir(mode=0o700)
            atomic_json(journal_path, staging_journal(
                plan_digest=args.expected_plan_digest,
                job=job,
                job_digest=expected_job_digests[job_id],
                status="copying",
                signing_secret=signing_secret,
            ))
            result = subprocess.run(
                [
                    "rsync", "-a", "--numeric-ids", "--delete",
                    "--chmod=D0555,F0444",
                    remote, f"{stage}/",
                ],
                check=False,
                capture_output=True,
                text=True,
            )
            if result.returncode == 0:
                stage.chmod(0o555)
            valid, reason = validate_harvested(
                stage,
                job,
                execution_identity,
                signing_secret,
                expected_job_digests[job_id],
                args.checkout_root,
                True,
            ) if result.returncode == 0 else (False, "terminal evidence unavailable")
            if not valid:
                quarantine_remnant(stage, quarantine_root, f"{job_id}.rejected")
                quarantine_remnant(journal_path, quarantine_root, f"{job_id}.rejected-journal")
                failures.append({"jobId": job_id, "reason": reason})
                continue
            adopted, reason = adopt_staged_terminal(
                stage=stage,
                journal_path=journal_path,
                target=target,
                quarantine_root=quarantine_root,
                plan_digest=args.expected_plan_digest,
                job=job,
                job_digest=expected_job_digests[job_id],
                execution_identity=execution_identity,
                signing_secret=signing_secret,
                checkout_root=args.checkout_root,
                require_terminal_metadata=True,
            )
            if not adopted or reason:
                failures.append({
                    "jobId": job_id,
                    "reason": reason or "validated staging publication failed",
                })
                continue
            observed_ids.add(job_id)
            summary = json.loads((target / "worker-summary.json").read_text(encoding="utf-8"))
            if summary.get("status") == "candidate":
                succeeded_ids.add(job_id)
                receipts.append(harvest_receipt(
                    target,
                    job,
                    execution_identity,
                    signing_secret,
                    expected_job_digests[job_id],
                    args.checkout_root,
                    True,
                ))
            else:
                failures.append({"jobId": job_id, "reason": "worker reported failed"})

    try:
        validate_remote_exact_sets(
            expected_job_ids,
            remote_entries(args.ssh_host, args.remote_job_root),
            remote_entries(args.ssh_host, args.remote_job_root, "f"),
            remote_entries(args.ssh_host, args.remote_artifact_root),
            remote_entries(args.ssh_host, args.remote_artifact_root, "d"),
            require_complete_terminals=True,
        )
        final_local = {entry.name for entry in local_root.iterdir()}
        if final_local != expected_job_ids:
            failures.append({
                "jobId": None,
                "reason": "local terminal set is partial, duplicate, stale, injected, missing, or extra",
            })
        fsync_directory(local_root)
    except (OSError, ValueError) as error:
        failures.append({"jobId": None, "reason": str(error)})

    observed = len(observed_ids)
    succeeded = len(succeeded_ids)
    failed = args.expected_job_count - succeeded
    complete = (
        not failures
        and observed == args.expected_job_count
        and succeeded == args.expected_job_count
        and failed == 0
        and len(receipts) == args.expected_job_count
        and {receipt["jobId"] for receipt in receipts} == expected_job_ids
    )
    disposition, _ = publish_harvest_state(
        state_file,
        state_payload(
            args,
            status="ready_for_independent_replay" if complete else "failed",
            artifact_root=local_root,
            failures=failures,
            observed=observed,
            succeeded=succeeded,
            failed=failed,
            receipts=receipts,
            truth_boundary=(
                "Harvest completion is not qualification. Independent control-plane replay and one atomic signed apply remain required."
                if complete
                else "Harvest rejected a partial, failed, stale, injected, duplicate, missing, extra, or mismatched terminal set."
            ),
        ),
        expected_sha256=running_state_sha256,
        args=args,
        signing_secret=signing_secret,
    )
    if disposition == "adopted_ready":
        return 0
    return 0 if complete else 4


def main() -> int:
    args = parse_args()
    lock_descriptor = None
    try:
        validate_arguments(args)
        state_file = pathlib.Path(args.state_file)
        lock_descriptor = acquire_campaign_harvest_lock(
            pathlib.Path(args.campaign_lock),
            state_file,
        )
        signing_secret = read_owner_secret(
            pathlib.Path(args.secret),
            args.expected_key_id,
        )
        existing_state, initial_state_sha256 = read_harvest_state(state_file)
        if existing_state is not None:
            if not state_matches_campaign(existing_state, args, signing_secret):
                raise ValueError(
                    "existing qualification harvest state is unauthenticated or mismatched"
                )
            if existing_state.get("status") == "ready_for_independent_replay":
                adopt_durable_harvest_state(
                    state_file,
                    args,
                    signing_secret,
                    required_status="ready_for_independent_replay",
                )
                return 0
        return harvest_under_lock(args, signing_secret, initial_state_sha256)
    except (OSError, ValueError, TypeError, KeyError, json.JSONDecodeError) as error:
        print(f"qualification harvest failed closed: {error}", file=sys.stderr)
        return 4
    finally:
        if lock_descriptor is not None:
            os.close(lock_descriptor)


if __name__ == "__main__":
    raise SystemExit(main())
