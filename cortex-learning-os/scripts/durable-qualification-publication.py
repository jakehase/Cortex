#!/usr/bin/env python3
"""Crash-durable, no-replace publication for qualification launch artifacts."""

from __future__ import annotations

import ctypes
import errno
import hashlib
import json
import os
import pathlib
import re
import stat
import sys
from typing import Callable, Optional


SAFE_ABSOLUTE_PATH = re.compile(r"^/[A-Za-z0-9._/-]+$")
DIGEST = re.compile(r"^[0-9a-f]{64}$")
RENAME_NOREPLACE = 1
EXPECTED_UID = os.geteuid()
EXPECTED_GID = os.getegid()


class PublicationError(RuntimeError):
    """The publication cannot be safely completed or adopted."""


def _validate_file_metadata_contract(
    value: Optional[tuple[int, int, int]],
) -> None:
    if value is None:
        return
    if (
        not isinstance(value, tuple)
        or len(value) != 3
        or any(not isinstance(item, int) or isinstance(item, bool) for item in value)
    ):
        raise PublicationError("explicit file metadata contract is invalid")
    expected_uid, expected_gid, expected_mode = value
    if (
        expected_uid != EXPECTED_UID
        or expected_gid < 0
        or expected_gid > 2**32 - 1
        or expected_mode < 0
        or expected_mode > 0o777
        or expected_mode & 0o022
        or not expected_mode & 0o400
    ):
        raise PublicationError(
            "explicit file metadata weakens publisher ownership or write protection"
        )


def _assert_safe_path(value: str, label: str) -> pathlib.Path:
    if not isinstance(value, str) or not SAFE_ABSOLUTE_PATH.fullmatch(value):
        raise PublicationError(f"{label} must be a safe absolute path")
    target = pathlib.Path(value)
    if (
        target.name in {"", ".", ".."}
        or any(component in {".", ".."} for component in target.parts[1:])
    ):
        raise PublicationError(f"{label} must name one exact artifact")
    return target


def _open_directory(target: pathlib.Path) -> int:
    return os.open(
        target,
        os.O_RDONLY
        | getattr(os, "O_DIRECTORY", 0)
        | getattr(os, "O_NOFOLLOW", 0)
        | getattr(os, "O_CLOEXEC", 0),
    )


def _directory_identity(descriptor: int) -> tuple:
    observed = os.fstat(descriptor)
    return (
        observed.st_dev,
        observed.st_ino,
        observed.st_uid,
        observed.st_gid,
        stat.S_IMODE(observed.st_mode),
    )


def _safe_ancestor(observed: os.stat_result, filesystem_uid: int) -> bool:
    sticky_world_writable = (
        observed.st_mode & stat.S_ISVTX
        and observed.st_mode & stat.S_IWOTH
        and observed.st_uid == filesystem_uid
    )
    return (
        stat.S_ISDIR(observed.st_mode)
        and observed.st_nlink > 0
        and observed.st_uid in {filesystem_uid, EXPECTED_UID}
        and (
            not observed.st_mode & (stat.S_IWGRP | stat.S_IWOTH)
            or sticky_world_writable
        )
    )


def _open_protected_parent(target: pathlib.Path, label: str) -> int:
    resolved = pathlib.Path(os.path.abspath(target))
    parts = resolved.parts
    filesystem_descriptor = _open_directory(pathlib.Path("/"))
    try:
        filesystem_uid = os.fstat(filesystem_descriptor).st_uid
    finally:
        os.close(filesystem_descriptor)

    if (
        len(parts) >= 6
        and parts[:4] == ("/", "proc", "self", "fd")
        and parts[4].isdigit()
    ):
        descriptor = os.dup(int(parts[4]))
        components = parts[5:-1]
        traversed = f"/proc/self/fd/{parts[4]}"
    else:
        descriptor = _open_directory(pathlib.Path("/"))
        components = parts[1:-1]
        traversed = "/"

    try:
        for component in components:
            ancestor = os.fstat(descriptor)
            if not _safe_ancestor(ancestor, filesystem_uid):
                raise PublicationError(
                    f"{label} ancestor is unsafe: {traversed}"
                )
            child = os.open(
                component,
                os.O_RDONLY
                | getattr(os, "O_DIRECTORY", 0)
                | getattr(os, "O_NOFOLLOW", 0)
                | getattr(os, "O_CLOEXEC", 0),
                dir_fd=descriptor,
            )
            os.close(descriptor)
            descriptor = child
            traversed = os.path.join(traversed, component)
        parent = os.fstat(descriptor)
        if not _safe_ancestor(parent, filesystem_uid):
            raise PublicationError(
                f"{label} parent must be caller-owned protected material"
            )
        return descriptor
    except Exception:
        os.close(descriptor)
        raise


def _fsync_directory(target: pathlib.Path) -> None:
    descriptor = _open_directory(target)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _fsync_pinned_directory(descriptor: int, logical_path: pathlib.Path) -> None:
    del logical_path
    os.fsync(descriptor)


def _assert_named_parent_identity(
    target: pathlib.Path,
    label: str,
    expected: tuple,
) -> None:
    descriptor = _open_protected_parent(target, label)
    try:
        if _directory_identity(descriptor) != expected:
            raise PublicationError(
                f"{label} parent identity changed during publication"
            )
    finally:
        os.close(descriptor)


def _hash_open_file(descriptor: int) -> str:
    digest = hashlib.sha256()
    os.lseek(descriptor, 0, os.SEEK_SET)
    while True:
        chunk = os.read(descriptor, 1024 * 1024)
        if not chunk:
            break
        digest.update(chunk)
    return digest.hexdigest()


def _stable_stat_identity(observed: os.stat_result) -> tuple:
    return (
        observed.st_dev,
        observed.st_ino,
        observed.st_uid,
        observed.st_gid,
        observed.st_mode,
        observed.st_nlink,
        observed.st_size,
        observed.st_mtime_ns,
        observed.st_ctime_ns,
    )


def _file_identity(
    target: pathlib.Path,
    *,
    synchronize: bool,
    expected_metadata: Optional[tuple[int, int, int]] = None,
) -> tuple:
    descriptor = os.open(
        target,
        os.O_RDONLY
        | getattr(os, "O_NOFOLLOW", 0)
        | getattr(os, "O_NONBLOCK", 0)
        | getattr(os, "O_CLOEXEC", 0),
    )
    named_descriptor = None
    try:
        before = os.fstat(descriptor)
        expected_uid = EXPECTED_UID
        expected_gid = EXPECTED_GID
        expected_mode = None
        if expected_metadata is not None:
            expected_uid, expected_gid, expected_mode = expected_metadata
        observed_mode = stat.S_IMODE(before.st_mode)
        if (not stat.S_ISREG(before.st_mode)
                or before.st_nlink != 1
                or before.st_uid != expected_uid
                or before.st_gid != expected_gid
                or before.st_mode & 0o022
                or (expected_mode is not None
                    and observed_mode != expected_mode)):
            raise PublicationError(
                f"qualification publication file is unsafe: {target}"
            )
        digest = _hash_open_file(descriptor)
        after = os.fstat(descriptor)
        if synchronize:
            os.fsync(descriptor)
        named_descriptor = os.open(
            target,
            os.O_RDONLY
            | getattr(os, "O_NOFOLLOW", 0)
            | getattr(os, "O_NONBLOCK", 0)
            | getattr(os, "O_CLOEXEC", 0),
        )
        named = os.fstat(named_descriptor)
        if (
            _stable_stat_identity(before) != _stable_stat_identity(after)
            or _stable_stat_identity(after) != _stable_stat_identity(named)
        ):
            raise PublicationError(
                f"qualification publication file changed while reading: {target}"
            )
        return (
            "file",
            before.st_uid,
            before.st_gid,
            stat.S_IMODE(before.st_mode),
            before.st_size,
            digest,
        )
    finally:
        if named_descriptor is not None:
            os.close(named_descriptor)
        os.close(descriptor)


def _walk_immutable_tree(
    root: pathlib.Path,
    *,
    synchronize: bool,
) -> tuple[str, list[pathlib.Path]]:
    directory_flags = (
        os.O_RDONLY
        | getattr(os, "O_DIRECTORY", 0)
        | getattr(os, "O_NOFOLLOW", 0)
        | getattr(os, "O_CLOEXEC", 0)
    )
    entry_flags = (
        os.O_RDONLY
        | getattr(os, "O_NOFOLLOW", 0)
        | getattr(os, "O_NONBLOCK", 0)
        | getattr(os, "O_CLOEXEC", 0)
    )
    root_descriptor = os.open(root, directory_flags)
    records: list[tuple] = []
    directories = [root]

    def assert_directory(
        observed: os.stat_result,
        relative_text: str,
    ) -> None:
        if (
            not stat.S_ISDIR(observed.st_mode)
            or observed.st_nlink < 1
            or observed.st_uid != EXPECTED_UID
            or observed.st_gid != EXPECTED_GID
            or observed.st_mode & 0o222
        ):
            raise PublicationError(
                "qualification publication directory is mutable: "
                f"{relative_text or '.'}"
            )

    def walk(
        directory_descriptor: int,
        directory: pathlib.Path,
        relative: pathlib.PurePosixPath,
    ) -> None:
        directory_before = os.fstat(directory_descriptor)
        assert_directory(directory_before, relative.as_posix())
        for name in sorted(os.listdir(directory_descriptor)):
            if (
                name in {"", ".", ".."}
                or "/" in name
                or any(ord(character) < 32 or ord(character) == 127 for character in name)
            ):
                raise PublicationError(
                    "qualification publication tree contains an unsafe entry name"
                )
            entry_path = directory / name
            entry_relative = relative / name
            relative_text = entry_relative.as_posix()
            descriptor = os.open(name, entry_flags, dir_fd=directory_descriptor)
            try:
                before = os.fstat(descriptor)
                if stat.S_ISDIR(before.st_mode):
                    assert_directory(before, relative_text)
                    records.append((
                        "directory",
                        relative_text,
                        before.st_uid,
                        before.st_gid,
                        stat.S_IMODE(before.st_mode),
                    ))
                    directories.append(entry_path)
                    walk(descriptor, entry_path, entry_relative)
                    after = os.fstat(descriptor)
                    if (
                        _stable_stat_identity(before)
                        != _stable_stat_identity(after)
                    ):
                        raise PublicationError(
                            "qualification publication directory changed while "
                            f"reading: {relative_text}"
                        )
                    continue
                if (
                    not stat.S_ISREG(before.st_mode)
                    or before.st_nlink != 1
                    or before.st_uid != EXPECTED_UID
                    or before.st_gid != EXPECTED_GID
                    or before.st_mode & 0o222
                ):
                    raise PublicationError(
                        f"qualification publication file is mutable: {relative_text}"
                    )
                file_digest = _hash_open_file(descriptor)
                after = os.fstat(descriptor)
                if (
                    _stable_stat_identity(before)
                    != _stable_stat_identity(after)
                ):
                    raise PublicationError(
                        "qualification publication file changed while reading: "
                        f"{relative_text}"
                    )
                if synchronize:
                    os.fsync(descriptor)
                records.append((
                    "file",
                    relative_text,
                    before.st_uid,
                    before.st_gid,
                    stat.S_IMODE(before.st_mode),
                    before.st_size,
                    file_digest,
                ))
            finally:
                os.close(descriptor)
        directory_after = os.fstat(directory_descriptor)
        if (
            _stable_stat_identity(directory_before)
            != _stable_stat_identity(directory_after)
        ):
            raise PublicationError(
                "qualification publication directory changed while reading: "
                f"{relative.as_posix() or '.'}"
            )
        if synchronize:
            os.fsync(directory_descriptor)

    try:
        root_before = os.fstat(root_descriptor)
        assert_directory(root_before, ".")
        walk(root_descriptor, root, pathlib.PurePosixPath())
        root_after = os.fstat(root_descriptor)
        named_root = os.stat(root, follow_symlinks=False)
        if (
            _stable_stat_identity(root_before)
            != _stable_stat_identity(root_after)
            or _stable_stat_identity(root_after)
            != _stable_stat_identity(named_root)
        ):
            raise PublicationError(
                "qualification publication tree root changed while reading"
            )
        payload = json.dumps(
            {
                "root": {
                    "uid": root_before.st_uid,
                    "gid": root_before.st_gid,
                    "mode": stat.S_IMODE(root_before.st_mode),
                },
                "entries": records,
            },
            ensure_ascii=True,
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
        return hashlib.sha256(payload).hexdigest(), directories
    finally:
        os.close(root_descriptor)


def publication_identity(
    target: str | pathlib.Path,
    kind: str,
    *,
    synchronize: bool = False,
    expected_file_metadata: Optional[tuple[int, int, int]] = None,
) -> tuple:
    resolved = pathlib.Path(target)
    if kind == "file":
        _validate_file_metadata_contract(expected_file_metadata)
        return _file_identity(
            resolved,
            synchronize=synchronize,
            expected_metadata=expected_file_metadata,
        )
    if expected_file_metadata is not None:
        raise PublicationError(
            "an explicit file metadata contract requires file publication"
        )
    if kind == "immutable-tree":
        digest, _directories = _walk_immutable_tree(
            resolved,
            synchronize=synchronize,
        )
        return ("immutable-tree", digest)
    raise PublicationError("publication kind must be file or immutable-tree")


def publication_digest(target: str | pathlib.Path, kind: str) -> str:
    identity = publication_identity(target, kind)
    return identity[-1]


def _rename_noreplace(
    source_name: str,
    source_directory: int,
    destination_name: str,
    destination_directory: int,
) -> bool:
    libc = ctypes.CDLL(None, use_errno=True)
    if not hasattr(libc, "renameat2"):
        raise PublicationError("renameat2(RENAME_NOREPLACE) is unavailable")
    renameat2 = libc.renameat2
    renameat2.argtypes = [
        ctypes.c_int,
        ctypes.c_char_p,
        ctypes.c_int,
        ctypes.c_char_p,
        ctypes.c_uint,
    ]
    renameat2.restype = ctypes.c_int
    result = renameat2(
        source_directory,
        os.fsencode(source_name),
        destination_directory,
        os.fsencode(destination_name),
        RENAME_NOREPLACE,
    )
    if result == 0:
        return True
    observed_errno = ctypes.get_errno()
    if observed_errno == errno.EEXIST:
        return False
    raise OSError(
        observed_errno,
        os.strerror(observed_errno),
        f"{source_name} -> {destination_name}",
    )


def _remove_exact_staging(target: pathlib.Path, kind: str) -> None:
    if kind == "file":
        target.unlink()
        return
    directories: list[pathlib.Path] = []
    files: list[pathlib.Path] = []
    for directory, child_directories, child_files in os.walk(
        target,
        topdown=True,
        followlinks=False,
    ):
        directory_path = pathlib.Path(directory)
        directories.append(directory_path)
        for name in child_directories:
            child = directory_path / name
            if child.is_symlink():
                raise PublicationError(
                    "refusing to remove a symlink from an adopted staging tree"
                )
        for name in child_files:
            child = directory_path / name
            if child.is_symlink():
                raise PublicationError(
                    "refusing to remove a symlink from an adopted staging tree"
                )
            files.append(child)
    for child in files:
        child.unlink()
    for directory in reversed(directories):
        directory.rmdir()


def publish(
    staging_value: str,
    final_value: str,
    kind: str,
    expected_digest: str,
    *,
    crash_injector: Optional[Callable[[str], None]] = None,
    expected_file_metadata: Optional[tuple[int, int, int]] = None,
) -> dict:
    staging = _assert_safe_path(staging_value, "staging path")
    final = _assert_safe_path(final_value, "final path")
    if staging == final or not DIGEST.fullmatch(str(expected_digest)):
        raise PublicationError("publication paths or expected digest are invalid")
    staging_parent = _open_protected_parent(staging, "staging")
    final_parent = None
    try:
        final_parent = _open_protected_parent(final, "final")
        staging_parent_identity = _directory_identity(staging_parent)
        final_parent_identity = _directory_identity(final_parent)
        staging_view = pathlib.Path(
            f"/proc/self/fd/{staging_parent}/{staging.name}"
        )
        final_view = pathlib.Path(f"/proc/self/fd/{final_parent}/{final.name}")
        if crash_injector is not None:
            crash_injector("after_parent_pin")

        staging_exists = os.path.lexists(staging_view)
        final_exists = os.path.lexists(final_view)
        if not staging_exists and not final_exists:
            raise PublicationError(
                "neither staged nor published qualification material exists"
            )

        staging_identity = None
        if staging_exists:
            staging_identity = publication_identity(
                staging_view,
                kind,
                synchronize=True,
                expected_file_metadata=expected_file_metadata,
            )
            if staging_identity[-1] != expected_digest:
                raise PublicationError(
                    "staged qualification material differs from authenticated bytes"
                )

        if final_exists:
            final_identity = publication_identity(
                final_view,
                kind,
                synchronize=True,
                expected_file_metadata=expected_file_metadata,
            )
            if final_identity[-1] != expected_digest:
                raise PublicationError(
                    "published qualification material differs from authenticated bytes"
                )
            if staging_identity is not None:
                if staging_identity != final_identity:
                    raise PublicationError(
                        "staged and published qualification material differ"
                    )
                _remove_exact_staging(staging_view, kind)
            _fsync_pinned_directory(staging_parent, staging.parent)
            _fsync_pinned_directory(final_parent, final.parent)
            _assert_named_parent_identity(
                staging,
                "staging",
                staging_parent_identity,
            )
            _assert_named_parent_identity(final, "final", final_parent_identity)
            return {
                "status": "adopted",
                "kind": kind,
                "digest": expected_digest,
                "stagingAbsent": not os.path.lexists(staging_view),
                "finalPresent": os.path.lexists(final_view),
            }

        if staging_identity is None:
            raise PublicationError("staged qualification material disappeared")
        renamed = _rename_noreplace(
            staging.name,
            staging_parent,
            final.name,
            final_parent,
        )
        if not renamed:
            final_identity = publication_identity(
                final_view,
                kind,
                synchronize=True,
                expected_file_metadata=expected_file_metadata,
            )
            if final_identity != staging_identity:
                raise PublicationError(
                    "concurrent qualification publication differs from staged material"
                )
            _remove_exact_staging(staging_view, kind)
            _fsync_pinned_directory(staging_parent, staging.parent)
            _fsync_pinned_directory(final_parent, final.parent)
            _assert_named_parent_identity(
                staging,
                "staging",
                staging_parent_identity,
            )
            _assert_named_parent_identity(final, "final", final_parent_identity)
            return {
                "status": "adopted",
                "kind": kind,
                "digest": expected_digest,
                "stagingAbsent": not os.path.lexists(staging_view),
                "finalPresent": os.path.lexists(final_view),
            }
        if crash_injector is not None:
            crash_injector("after_rename")
        _fsync_pinned_directory(staging_parent, staging.parent)
        if crash_injector is not None:
            crash_injector("after_source_parent_fsync")
        _fsync_pinned_directory(final_parent, final.parent)
        final_identity = publication_identity(
            final_view,
            kind,
            expected_file_metadata=expected_file_metadata,
        )
        if final_identity != staging_identity:
            raise PublicationError(
                "published qualification material changed across rename"
            )
        _assert_named_parent_identity(
            staging,
            "staging",
            staging_parent_identity,
        )
        _assert_named_parent_identity(final, "final", final_parent_identity)
        return {
            "status": "published",
            "kind": kind,
            "digest": expected_digest,
            "stagingAbsent": not os.path.lexists(staging_view),
            "finalPresent": os.path.lexists(final_view),
        }
    finally:
        if final_parent is not None:
            os.close(final_parent)
        os.close(staging_parent)


def _main(argv: list[str]) -> int:
    if os.geteuid() != 0:
        raise PublicationError(
            "production qualification publication must run as root"
        )
    if len(argv) < 2:
        raise PublicationError("expected digest or publish command")
    command = argv[1]
    if command == "digest" and len(argv) == 4:
        target = _assert_safe_path(argv[3], "digest path")
        sys.stdout.write(f"{publication_digest(target, argv[2])}\n")
        return 0
    if command == "publish" and len(argv) in {6, 9}:
        expected_file_metadata = None
        if len(argv) == 9:
            if argv[2] != "file":
                raise PublicationError(
                    "an explicit file metadata contract requires file publication"
                )
            if (
                not re.fullmatch(r"0|[1-9][0-9]{0,9}", argv[6])
                or not re.fullmatch(r"0|[1-9][0-9]{0,9}", argv[7])
                or not re.fullmatch(r"0[0-7]{3}", argv[8])
            ):
                raise PublicationError(
                    "explicit file uid, gid, or mode is invalid"
                )
            expected_uid = int(argv[6], 10)
            expected_gid = int(argv[7], 10)
            expected_mode = int(argv[8], 8)
            if (
                expected_uid != EXPECTED_UID
                or expected_mode & 0o022
                or not expected_mode & 0o400
            ):
                raise PublicationError(
                    "explicit file metadata weakens publisher ownership or write protection"
                )
            expected_file_metadata = (
                expected_uid,
                expected_gid,
                expected_mode,
            )
        result = publish(
            argv[3],
            argv[4],
            argv[2],
            argv[5],
            expected_file_metadata=expected_file_metadata,
        )
        sys.stdout.write(f"{json.dumps(result, sort_keys=True)}\n")
        return 0
    raise PublicationError(
        "expected digest KIND PATH or publish KIND STAGING FINAL DIGEST "
        "[EXPECTED_UID EXPECTED_GID EXPECTED_MODE]"
    )


if __name__ == "__main__":
    try:
        raise SystemExit(_main(sys.argv))
    except (OSError, PublicationError) as error:
        sys.stderr.write(f"durable qualification publication failed: {error}\n")
        raise SystemExit(3)
