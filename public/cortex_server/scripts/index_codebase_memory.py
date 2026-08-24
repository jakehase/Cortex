#!/usr/bin/env python3
"""Index a repository into Cortex's structural code graph.

This is the practical Cortex-native equivalent of the codebase-memory "index this
project" flow. It runs offline so large repositories do not block the FastAPI
request loop, then Cortex serves the resulting graph through /knowledge/structural/*.
"""
from __future__ import annotations

import argparse
import asyncio
import fcntl
import hashlib
import json
import os
import sqlite3
import stat
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from cortex_server.models.requests import ParseDirectoryRequest  # noqa: E402
from cortex_server.services.codebase_snapshot import (  # noqa: E402
    SNAPSHOT_ALGORITHM,
    codebase_source_snapshot,
)
from cortex_server.services.parser_service import ParserService  # noqa: E402

DEFAULT_EXCLUDES = [
    "node_modules/**",
    "artifacts/**",
    ".git/**",
    "tmp/**",
    "dist/**",
    "coverage/**",
    "**/*.min.js",
]
INDEX_ARTIFACT_SCHEMA_VERSION = "cortex.codebase-index-artifact.v3"
INDEXER_VERSION = "cortex-structural-indexer.v3"


def source_identity(repo: Path) -> dict:
    identity = {
        "sourceCommit": None,
        "sourceTreeDigest": None,
        "sourceClean": False,
    }
    try:
        commit = subprocess.run(
            ["git", "-C", str(repo), "rev-parse", "--verify", "HEAD"],
            check=True,
            capture_output=True,
            text=True,
            timeout=10,
        ).stdout.strip()
        tree = subprocess.run(
            ["git", "-C", str(repo), "rev-parse", "--verify", "HEAD^{tree}"],
            check=True,
            capture_output=True,
            text=True,
            timeout=10,
        ).stdout.strip()
        status = subprocess.run(
            [
                "git",
                "-C",
                str(repo),
                "status",
                "--porcelain=v1",
                "--untracked-files=normal",
            ],
            check=True,
            capture_output=True,
            text=True,
            timeout=10,
        ).stdout
        if len(commit) != 40 or len(tree) != 40:
            raise ValueError("git returned a non-SHA-1 identity")
        identity.update(
            sourceCommit=commit,
            sourceTreeDigest=tree,
            sourceClean=not bool(status.strip()),
        )
    except Exception as exc:
        identity["sourceIdentityError"] = f"{type(exc).__name__}: {exc}"
    return identity


def source_git_root(repo: Path) -> Path:
    value = subprocess.run(
        ["git", "-C", str(repo), "rev-parse", "--show-toplevel"],
        check=True,
        capture_output=True,
        text=True,
        timeout=10,
    ).stdout.strip()
    root = Path(value).resolve(strict=True)
    if not root.is_dir():
        raise RuntimeError("Git source root is not a directory")
    return root


def artifact_staging_parent(repo: Path, db_path: Path) -> Path:
    """Return a same-filesystem staging parent outside the source worktree."""

    git_root = source_git_root(repo)
    db_parent = db_path.parent.resolve(strict=True)
    try:
        db_parent.relative_to(git_root)
    except ValueError:
        parent = db_parent
    else:
        parent = git_root.parent.resolve(strict=True)
    if parent.stat().st_dev != db_parent.stat().st_dev:
        raise RuntimeError(
            "cannot atomically stage the graph outside the indexed Git worktree"
        )
    return parent


def validate_runtime_destination(repo: Path, destination: Path, label: str) -> None:
    """Require mutable index outputs inside the source worktree to be ignored."""

    git_root = source_git_root(repo)
    try:
        relative = destination.resolve().relative_to(git_root).as_posix()
    except ValueError:
        return
    tracked = subprocess.run(
        ["git", "-C", str(git_root), "ls-files", "--error-unmatch", "--", relative],
        capture_output=True,
        text=True,
        timeout=10,
    )
    if tracked.returncode == 0:
        raise RuntimeError(f"{label} cannot overwrite a tracked source file")
    ignored = subprocess.run(
        ["git", "-C", str(git_root), "check-ignore", "-q", "--no-index", "--", relative],
        capture_output=True,
        text=True,
        timeout=10,
    )
    if ignored.returncode != 0:
        raise RuntimeError(
            f"{label} inside the indexed worktree must be explicitly Git-ignored"
        )


def graph_database_counts(path: Path) -> dict[str, int]:
    if path.is_symlink() or not path.is_file():
        raise RuntimeError("indexed graph must be a regular non-symlink file")
    connection = sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro&immutable=1", uri=True)
    try:
        schema = {
            str(name): str(kind)
            for name, kind in connection.execute(
                "SELECT name, type FROM sqlite_master "
                "WHERE name IN ('nodes', 'edges')"
            )
        }
        if schema != {"nodes": "table", "edges": "table"}:
            raise RuntimeError("indexed graph is missing its required SQLite schema")
        return {
            "nodeCount": int(connection.execute("SELECT COUNT(*) FROM nodes").fetchone()[0]),
            "edgeCount": int(connection.execute("SELECT COUNT(*) FROM edges").fetchone()[0]),
        }
    except sqlite3.Error as exc:
        raise RuntimeError("indexed graph is not a readable SQLite graph") from exc
    finally:
        connection.close()


def acquire_offline_publication_lock(db_path: Path) -> int | None:
    if not db_path.exists():
        return None
    descriptor = os.open(
        db_path,
        os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0),
    )
    try:
        if not stat.S_ISREG(os.fstat(descriptor).st_mode):
            raise RuntimeError("graph destination must be a regular file")
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise RuntimeError(
                "offline graph publication requires all serving graph handles to be closed"
            ) from exc
        return descriptor
    except BaseException:
        os.close(descriptor)
        raise


def file_sha256(path: Path) -> str:
    if path.is_symlink():
        raise RuntimeError("indexed graph must be a regular non-symlink file")
    descriptor = os.open(
        path,
        os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0),
    )
    digest = hashlib.sha256()
    total = 0
    try:
        before = os.fstat(descriptor)
        if not stat.S_ISREG(before.st_mode):
            raise RuntimeError("indexed graph must be a regular non-symlink file")
        while True:
            chunk = os.read(descriptor, 1024 * 1024)
            if not chunk:
                break
            total += len(chunk)
            digest.update(chunk)
        after = os.fstat(descriptor)
        identity = lambda value: (
            value.st_dev,
            value.st_ino,
            value.st_mode,
            value.st_nlink,
            value.st_size,
            value.st_mtime_ns,
            value.st_ctime_ns,
        )
        if identity(before) != identity(after) or total != before.st_size:
            raise RuntimeError("indexed graph changed while hashing")
        return digest.hexdigest()
    finally:
        os.close(descriptor)


def close_parser_graph(service: object) -> None:
    graph = getattr(service, "_graph", None)
    storage = getattr(graph, "storage", None)
    close = getattr(storage, "close", None)
    if callable(close):
        close()
        return
    local = getattr(storage, "_local", None)
    connection = getattr(local, "conn", None)
    if connection is not None:
        connection.commit()
        connection.close()
        local.conn = None


async def parse_directory_with_heartbeat(
    service: ParserService, request: ParseDirectoryRequest
) -> dict:
    """Keep offline thread-completion callbacks observable on constrained loops."""

    task = asyncio.create_task(service.parse_directory(request))
    try:
        while not task.done():
            await asyncio.sleep(0.05)
        return await task
    except BaseException:
        if not task.done():
            task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        raise


def atomic_write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.", suffix=".tmp", dir=path.parent
    )
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as destination:
            json.dump(payload, destination, indent=2)
            destination.write("\n")
            destination.flush()
            os.fsync(destination.fileno())
        os.replace(temporary, path)
        directory = os.open(path.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass


def clear_graph(db_path: Path) -> None:
    if not db_path.exists():
        return
    if db_path.is_symlink() or not db_path.is_file():
        raise RuntimeError("graph reset target must be a regular non-symlink file")
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    try:
        tables = {
            str(row[0])
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            )
        }
        # A freshly provisioned rebuild target may be an existing empty SQLite
        # file. Treat only that exact state as an idempotent clear; a partial or
        # unrelated schema still fails closed instead of being silently reused.
        if not tables:
            return
        if not {"nodes", "edges"}.issubset(tables):
            raise RuntimeError("graph reset target does not contain the Cortex graph schema")
        conn.execute("DELETE FROM edges")
        conn.execute("DELETE FROM nodes")
        conn.commit()
    finally:
        conn.close()


async def run(args: argparse.Namespace) -> dict:
    repo = Path(args.repo).resolve()
    if not repo.exists() or not repo.is_dir():
        raise SystemExit(f"repo directory not found: {repo}")
    if args.artifact and not args.clear:
        raise RuntimeError(
            "publishing a provenance artifact requires an explicit --clear graph reset"
        )

    patterns = list(args.exclude)
    if len(patterns) > 128 or any(
        not isinstance(value, str) or len(value.encode("utf-8")) > 512
        for value in patterns
    ):
        raise RuntimeError("codebase snapshot exclude contract is invalid")
    request = ParseDirectoryRequest(
        directory=str(repo),
        recursive=not args.no_recursive,
        exclude_patterns=patterns,
    )
    identity_before = source_identity(repo)
    if identity_before.get("sourceIdentityError"):
        raise RuntimeError(
            f"cannot prove codebase source identity: {identity_before['sourceIdentityError']}"
        )
    if identity_before.get("sourceClean") is not True:
        raise RuntimeError("cannot publish a codebase index from a dirty source tree")
    snapshot_before = codebase_source_snapshot(
        repo,
        exclude_patterns=patterns,
        recursive=not args.no_recursive,
    )

    db_path = Path(args.db).resolve()
    if args.artifact:
        artifact_path = Path(args.artifact).resolve()
        if artifact_path == db_path:
            raise RuntimeError("graph and provenance artifact destinations must differ")
        validate_runtime_destination(repo, db_path, "graph destination")
        validate_runtime_destination(repo, artifact_path, "artifact destination")
    if db_path.exists() and (db_path.is_symlink() or not db_path.is_file()):
        raise RuntimeError("graph destination must be a regular non-symlink file")
    staging_path = None
    staging_directory = None
    working_db_path = db_path
    if args.artifact:
        db_path.parent.mkdir(parents=True, exist_ok=True)
        staging_directory = Path(tempfile.mkdtemp(
            prefix=".cortex-codebase-index-",
            dir=artifact_staging_parent(repo, db_path),
        ))
        staging_path = staging_directory / "graph.sqlite"
        working_db_path = staging_path

    previous_db_path = os.environ.get("CORTEX_DB_PATH")
    service = None
    installed_graph = False
    publication_ready = False
    started = time.time()
    try:
        os.environ["CORTEX_DB_PATH"] = str(working_db_path)
        if args.clear and staging_path is None:
            clear_graph(working_db_path)
        service = ParserService(workspace_roots=(repo,))
        result = await parse_directory_with_heartbeat(service, request)
        identity_after = source_identity(repo)
        snapshot_after = codebase_source_snapshot(
            repo,
            exclude_patterns=patterns,
            recursive=not args.no_recursive,
        )
        identity_fields = ("sourceCommit", "sourceTreeDigest", "sourceClean")
        if identity_after.get("sourceIdentityError") or any(
            identity_before.get(field) != identity_after.get(field)
            for field in identity_fields
        ):
            raise RuntimeError("codebase source identity changed while the graph was being indexed")
        if snapshot_before != snapshot_after:
            raise RuntimeError("codebase parser-candidate snapshot changed while the graph was being indexed")
        graph = result.get("graph") if isinstance(result.get("graph"), dict) else {}
        if (
            result.get("errors")
            or int(result.get("files_parsed", 0) or 0) != snapshot_after["fileCount"]
            or int(graph.get("nodeCount", 0) or 0) <= 0
            or int(graph.get("edgeCount", 0) or 0) <= 0
        ):
            raise RuntimeError("codebase index did not completely rebuild the structural graph")
        close_parser_graph(service)
        os.chmod(working_db_path, 0o600)
        database_counts = graph_database_counts(working_db_path)
        if database_counts != {
            "nodeCount": int(graph.get("nodeCount", 0) or 0),
            "edgeCount": int(graph.get("edgeCount", 0) or 0),
        }:
            raise RuntimeError("codebase index result does not match the staged SQLite graph")
        graph_digest = file_sha256(working_db_path)
        if staging_path is not None:
            with staging_path.open("rb") as source:
                os.fsync(source.fileno())
            publication_ready = True
    finally:
        if service is not None:
            close_parser_graph(service)
        if previous_db_path is None:
            os.environ.pop("CORTEX_DB_PATH", None)
        else:
            os.environ["CORTEX_DB_PATH"] = previous_db_path
        if staging_directory is not None and not publication_ready:
            for candidate in staging_directory.iterdir():
                try:
                    candidate.unlink()
                except FileNotFoundError:
                    pass
            try:
                staging_directory.rmdir()
            except FileNotFoundError:
                pass
    completed_at = datetime.now(timezone.utc).isoformat()
    result.update({
        "schemaVersion": INDEX_ARTIFACT_SCHEMA_VERSION,
        "indexerVersion": INDEXER_VERSION,
        "sourceRepo": str(repo),
        **identity_after,
        "sourceSnapshotAlgorithm": SNAPSHOT_ALGORITHM,
        "sourceSnapshotDigest": snapshot_after["digest"],
        "sourceSnapshotFileCount": snapshot_after["fileCount"],
        "sourceSnapshotBytes": snapshot_after["totalBytes"],
        "sourceSnapshotExcludePatterns": patterns,
        "sourceSnapshotRecursive": not args.no_recursive,
        "graphReset": bool(args.clear),
        "dbPath": str(db_path),
        "graphDigest": graph_digest,
        "graphDigestAlgorithm": "sha256",
        "completedAt": completed_at,
        "elapsedSeconds": round(time.time() - started, 3),
        "mode": "offline_structural_code_memory_index",
    })

    if args.artifact:
        artifact = Path(args.artifact).resolve()
        result["artifactPath"] = str(artifact)
        publication_lock = None
        prior_graph = staging_directory / "prior-graph.sqlite"
        graph_existed = db_path.exists()
        artifact_existed = artifact.exists()
        artifact_backup = artifact.with_name(
            f".{artifact.name}.{os.getpid()}.{time.time_ns()}.backup"
        )
        try:
            publication_lock = acquire_offline_publication_lock(db_path)
            if graph_existed:
                os.link(db_path, prior_graph, follow_symlinks=False)
            if artifact_existed:
                metadata = artifact.lstat()
                if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode):
                    raise RuntimeError(
                        "provenance artifact destination must be a regular non-symlink file"
                    )
                os.link(artifact, artifact_backup, follow_symlinks=False)
            atomic_write_json(artifact, result)
            os.replace(staging_path, db_path)
            installed_graph = True
            directory = os.open(
                db_path.parent,
                os.O_RDONLY | getattr(os, "O_DIRECTORY", 0),
            )
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
        except BaseException:
            if installed_graph:
                if graph_existed and prior_graph.exists():
                    os.replace(prior_graph, db_path)
                elif not graph_existed:
                    db_path.unlink(missing_ok=True)
                installed_graph = False
                directory = os.open(
                    db_path.parent,
                    os.O_RDONLY | getattr(os, "O_DIRECTORY", 0),
                )
                try:
                    os.fsync(directory)
                finally:
                    os.close(directory)
            if artifact_backup.exists():
                os.replace(artifact_backup, artifact)
            elif not artifact_existed:
                artifact.unlink(missing_ok=True)
            raise
        finally:
            if publication_lock is not None:
                os.close(publication_lock)
            artifact_backup.unlink(missing_ok=True)
            if staging_directory is not None:
                for candidate in staging_directory.iterdir():
                    candidate.unlink(missing_ok=True)
                staging_directory.rmdir()

    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("repo", help="repository/codebase directory to index")
    parser.add_argument(
        "--db",
        default=str(ROOT / "cortex_graph.db"),
        help="Cortex structural graph SQLite DB path",
    )
    parser.add_argument("--artifact", help="optional JSON proof artifact path")
    parser.add_argument("--clear", action="store_true", help="clear existing graph before indexing")
    parser.add_argument("--no-recursive", action="store_true", help="only index top-level files")
    parser.add_argument(
        "--exclude",
        action="append",
        default=list(DEFAULT_EXCLUDES),
        help="exclude glob; can be repeated",
    )
    args = parser.parse_args()
    # This offline CLI owns its loop. Closing it directly avoids waiting on a
    # broken execution-plane default-executor shutdown after all parser tasks
    # have already been observed and joined by ``run``.
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        result = loop.run_until_complete(run(args))
    finally:
        loop.close()
        asyncio.set_event_loop(None)
    summary = {
        key: result.get(key)
        for key in [
            "schemaVersion",
            "indexerVersion",
            "sourceRepo",
            "sourceCommit",
            "sourceTreeDigest",
            "sourceClean",
            "sourceSnapshotAlgorithm",
            "sourceSnapshotDigest",
            "sourceSnapshotFileCount",
            "sourceSnapshotBytes",
            "graphReset",
            "dbPath",
            "graphDigest",
            "completedAt",
            "files_seen",
            "files_skipped",
            "files_parsed",
            "nodes_added",
            "edges_added",
            "elapsedSeconds",
            "artifactPath",
        ]
    }
    summary["graph"] = result.get("graph")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
