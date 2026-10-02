import argparse
import asyncio
import hashlib
import json
import os
import sqlite3
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest

from cortex_server.routers import knowledge, librarian
from cortex_server.knowledge.graph import SQLiteStorage
from cortex_server.services.codebase_snapshot import (
    SNAPSHOT_ALGORITHM,
    codebase_source_snapshot,
)
from scripts import index_codebase_memory


def _write_graph_database(path: Path, *, node_count: int = 3, edge_count: int = 2) -> None:
    path.unlink(missing_ok=True)
    connection = sqlite3.connect(path)
    try:
        connection.execute("CREATE TABLE nodes (id TEXT PRIMARY KEY)")
        connection.execute("CREATE TABLE edges (id TEXT PRIMARY KEY)")
        connection.executemany(
            "INSERT INTO nodes (id) VALUES (?)",
            [(f"node-{index}",) for index in range(node_count)],
        )
        connection.executemany(
            "INSERT INTO edges (id) VALUES (?)",
            [(f"edge-{index}",) for index in range(edge_count)],
        )
        connection.commit()
    finally:
        connection.close()


def _write_index_artifact(
    path: Path,
    *,
    source_repo: Path,
    graph_path: Path,
    completed_at: str,
    graph_digest: str,
) -> None:
    snapshot = codebase_source_snapshot(
        source_repo,
        exclude_patterns=index_codebase_memory.DEFAULT_EXCLUDES,
        recursive=True,
    )
    path.write_text(
        json.dumps(
            {
                "schemaVersion": knowledge._CODEBASE_INDEX_SCHEMA_VERSION,
                "indexerVersion": knowledge._CODEBASE_INDEXER_VERSION,
                "sourceRepo": str(source_repo.resolve()),
                "sourceCommit": "a" * 40,
                "sourceTreeDigest": "b" * 40,
                "sourceClean": True,
                "sourceSnapshotAlgorithm": SNAPSHOT_ALGORITHM,
                "sourceSnapshotDigest": snapshot["digest"],
                "sourceSnapshotFileCount": snapshot["fileCount"],
                "sourceSnapshotBytes": snapshot["totalBytes"],
                "sourceSnapshotExcludePatterns": list(
                    index_codebase_memory.DEFAULT_EXCLUDES
                ),
                "sourceSnapshotRecursive": True,
                "graphReset": True,
                "dbPath": str(graph_path.resolve()),
                "graphDigest": graph_digest,
                "graphDigestAlgorithm": "sha256",
                "completedAt": completed_at,
                "files_parsed": 2,
                "files_skipped": 0,
                "nodes_added": 3,
                "edges_added": 2,
                "errors": [],
                "graph": {"nodeCount": 3, "edgeCount": 2},
            }
        ),
        encoding="utf-8",
    )


def test_latest_index_health_rejects_stale_legacy_artifact(monkeypatch, tmp_path):
    source_repo = tmp_path / "source"
    source_repo.mkdir()
    graph_path = tmp_path / "graph.db"
    graph_path.write_bytes(b"last-known-good-graph")
    artifact = tmp_path / "legacy-index.json"
    artifact.write_text(
        json.dumps(
            {
                "sourceRepo": str(source_repo),
                "dbPath": str(graph_path),
                "errors": [],
                "graph": {"nodeCount": 3, "edgeCount": 2},
                "completedAt": "1970-01-01T00:00:00+00:00",
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("CORTEX_CODEBASE_SOURCE_REPO", str(source_repo))
    monkeypatch.setattr(knowledge, "_latest_index_artifact", lambda: artifact)
    monkeypatch.setattr(knowledge, "_serving_graph_path", lambda: graph_path.resolve())
    monkeypatch.setattr(
        knowledge,
        "_git_source_identity",
        lambda root: {
            "sourceRepo": str(root),
            "sourceCommit": "a" * 40,
            "sourceTreeDigest": "b" * 40,
            "sourceClean": True,
        },
    )

    result = knowledge._latest_index_artifact_health()

    assert result["ok"] is False
    assert result["verified"] is False
    assert result["freshnessVerified"] is False
    assert "freshness_sla_failed" in result["verificationFailures"]
    assert "provenance_incomplete" in result["verificationFailures"]
    assert graph_path.read_bytes() == b"last-known-good-graph"


def test_latest_index_health_binds_source_and_serving_graph(monkeypatch, tmp_path):
    source_repo = tmp_path / "source"
    source_repo.mkdir()
    graph_path = tmp_path / "graph.db"
    _write_graph_database(graph_path)
    original_graph = graph_path.read_bytes()
    artifact = tmp_path / "index.json"
    digest = hashlib.sha256(graph_path.read_bytes()).hexdigest()
    _write_index_artifact(
        artifact,
        source_repo=source_repo,
        graph_path=graph_path,
        completed_at=datetime.now(timezone.utc).isoformat(),
        graph_digest=digest,
    )
    monkeypatch.setenv("CORTEX_CODEBASE_SOURCE_REPO", str(source_repo))
    monkeypatch.setattr(knowledge, "_latest_index_artifact", lambda: artifact)
    monkeypatch.setattr(knowledge, "_serving_graph_path", lambda: graph_path.resolve())
    monkeypatch.setattr(
        knowledge,
        "_serving_graph_runtime_counts",
        lambda: {"nodeCount": 3, "edgeCount": 2},
    )
    monkeypatch.setattr(
        knowledge,
        "_git_source_identity",
        lambda root: {
            "sourceRepo": str(root),
            "sourceCommit": "a" * 40,
            "sourceTreeDigest": "b" * 40,
            "sourceClean": True,
        },
    )

    healthy = knowledge._latest_index_artifact_health()
    assert healthy["ok"] is True
    assert healthy["sourceProvenance"]["verified"] is True
    assert healthy["graphProvenance"]["verified"] is True

    monkeypatch.setattr(
        knowledge,
        "_serving_graph_runtime_counts",
        lambda: {"nodeCount": 2, "edgeCount": 1},
    )
    runtime_mismatch = knowledge._latest_index_artifact_health()
    assert runtime_mismatch["ok"] is False
    assert runtime_mismatch["graphProvenance"]["countsMatch"] is False
    monkeypatch.setattr(
        knowledge,
        "_serving_graph_runtime_counts",
        lambda: {"nodeCount": 3, "edgeCount": 2},
    )

    graph_path.write_bytes(b"different-serving-graph")
    graph_mismatch = knowledge._latest_index_artifact_health()
    assert graph_mismatch["ok"] is False
    assert graph_mismatch["graphProvenance"]["digestMatches"] is False
    assert "serving_graph_mismatch" in graph_mismatch["verificationFailures"]

    graph_path.write_bytes(original_graph)
    payload = json.loads(artifact.read_text(encoding="utf-8"))
    payload["sourceRepo"] = str(tmp_path / "obsolete-source-copy")
    artifact.write_text(json.dumps(payload), encoding="utf-8")
    source_mismatch = knowledge._latest_index_artifact_health()
    assert source_mismatch["ok"] is False
    assert source_mismatch["sourceProvenance"]["repoMatches"] is False
    assert "serving_source_mismatch" in source_mismatch["verificationFailures"]


def test_latest_index_health_binds_ignored_parser_candidate_content(
    monkeypatch, tmp_path
):
    source_repo = tmp_path / "source"
    source_repo.mkdir()
    (source_repo / "tracked.py").write_text("TRACKED = 1\n", encoding="utf-8")
    ignored = source_repo / "ignored.py"
    ignored.write_text("IGNORED = 1\n", encoding="utf-8")
    graph_path = tmp_path / "graph.db"
    _write_graph_database(graph_path)
    artifact = tmp_path / "index.json"
    _write_index_artifact(
        artifact,
        source_repo=source_repo,
        graph_path=graph_path,
        completed_at=datetime.now(timezone.utc).isoformat(),
        graph_digest=hashlib.sha256(graph_path.read_bytes()).hexdigest(),
    )
    monkeypatch.setenv("CORTEX_CODEBASE_SOURCE_REPO", str(source_repo))
    monkeypatch.setattr(knowledge, "_latest_index_artifact", lambda: artifact)
    monkeypatch.setattr(knowledge, "_serving_graph_path", lambda: graph_path.resolve())
    monkeypatch.setattr(
        knowledge,
        "_serving_graph_runtime_counts",
        lambda: {"nodeCount": 3, "edgeCount": 2},
    )
    monkeypatch.setattr(
        knowledge,
        "_git_source_identity",
        lambda root: {
            "sourceRepo": str(root),
            "sourceCommit": "a" * 40,
            "sourceTreeDigest": "b" * 40,
            "sourceClean": True,
        },
    )

    assert knowledge._latest_index_artifact_health()["verified"] is True

    ignored.write_text("IGNORED = 2\n", encoding="utf-8")
    changed = knowledge._latest_index_artifact_health()

    assert changed["ok"] is False
    assert changed["sourceProvenance"]["snapshotDigestMatches"] is False
    assert "source_snapshot_mismatch" in changed["verificationFailures"]


def test_offline_indexer_publishes_complete_provenance(monkeypatch, tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    (repo / "source.py").write_text("VALUE = 1\n", encoding="utf-8")
    db_path = tmp_path / "graph.db"
    artifact = tmp_path / "artifact.json"

    class FakeParserService:
        def __init__(self, **_kwargs):
            pass

        async def parse_directory(self, _request):
            _write_graph_database(
                Path(os.environ["CORTEX_DB_PATH"]), node_count=2, edge_count=1
            )
            return {
                "files_parsed": 1,
                "files_skipped": 0,
                "nodes_added": 2,
                "edges_added": 1,
                "errors": [],
                "graph": {"nodeCount": 2, "edgeCount": 1},
            }

    monkeypatch.setattr(index_codebase_memory, "ParserService", FakeParserService)
    monkeypatch.setattr(index_codebase_memory, "clear_graph", lambda _path: None)
    monkeypatch.setattr(
        index_codebase_memory, "artifact_staging_parent", lambda _repo, _db: tmp_path
    )
    monkeypatch.setattr(
        index_codebase_memory,
        "validate_runtime_destination",
        lambda _repo, _path, _label: None,
    )
    monkeypatch.setattr(
        index_codebase_memory,
        "source_identity",
        lambda _repo: {
            "sourceCommit": "c" * 40,
            "sourceTreeDigest": "d" * 40,
            "sourceClean": True,
        },
    )
    args = argparse.Namespace(
        repo=str(repo),
        db=str(db_path),
        artifact=str(artifact),
        clear=True,
        no_recursive=False,
        exclude=[],
    )

    result = asyncio.run(index_codebase_memory.run(args))
    published = json.loads(artifact.read_text(encoding="utf-8"))

    assert result["schemaVersion"] == knowledge._CODEBASE_INDEX_SCHEMA_VERSION
    assert published["indexerVersion"] == knowledge._CODEBASE_INDEXER_VERSION
    assert published["sourceCommit"] == "c" * 40
    assert published["sourceTreeDigest"] == "d" * 40
    assert published["sourceClean"] is True
    assert published["graphReset"] is True
    assert published["sourceSnapshotAlgorithm"] == SNAPSHOT_ALGORITHM
    assert published["sourceSnapshotDigest"] == codebase_source_snapshot(
        repo,
        exclude_patterns=[],
        recursive=True,
    )["digest"]
    assert published["graphDigest"] == hashlib.sha256(db_path.read_bytes()).hexdigest()
    assert datetime.fromisoformat(published["completedAt"]).tzinfo is not None


def test_offline_indexer_refuses_artifact_when_source_changes(monkeypatch, tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    (repo / "source.py").write_text("VALUE = 1\n", encoding="utf-8")
    db_path = tmp_path / "graph.db"
    db_path.write_bytes(b"last-known-good-graph")
    artifact = tmp_path / "artifact.json"

    class FakeParserService:
        def __init__(self, **_kwargs):
            pass

        async def parse_directory(self, _request):
            Path(os.environ["CORTEX_DB_PATH"]).write_bytes(
                b"graph-from-unstable-source"
            )
            return {
                "files_parsed": 1,
                "errors": [],
                "graph": {"nodeCount": 1, "edgeCount": 1},
            }

    identities = iter(
        [
            {
                "sourceCommit": "c" * 40,
                "sourceTreeDigest": "d" * 40,
                "sourceClean": True,
            },
            {
                "sourceCommit": "e" * 40,
                "sourceTreeDigest": "f" * 40,
                "sourceClean": True,
            },
        ]
    )
    monkeypatch.setattr(index_codebase_memory, "ParserService", FakeParserService)
    monkeypatch.setattr(index_codebase_memory, "clear_graph", lambda _path: None)
    monkeypatch.setattr(
        index_codebase_memory, "artifact_staging_parent", lambda _repo, _db: tmp_path
    )
    monkeypatch.setattr(
        index_codebase_memory,
        "validate_runtime_destination",
        lambda _repo, _path, _label: None,
    )
    monkeypatch.setattr(
        index_codebase_memory, "source_identity", lambda _repo: next(identities)
    )
    args = argparse.Namespace(
        repo=str(repo),
        db=str(db_path),
        artifact=str(artifact),
        clear=True,
        no_recursive=False,
        exclude=[],
    )

    with pytest.raises(RuntimeError, match="source identity changed"):
        asyncio.run(index_codebase_memory.run(args))

    assert not artifact.exists()
    assert db_path.read_bytes() == b"last-known-good-graph"


def test_offline_indexer_refuses_provenance_artifact_without_graph_reset(
    monkeypatch, tmp_path
):
    repo = tmp_path / "repo"
    repo.mkdir()
    artifact = tmp_path / "artifact.json"
    parser_called = False

    class FakeParserService:
        def __init__(self, **_kwargs):
            pass

        async def parse_directory(self, _request):
            nonlocal parser_called
            parser_called = True
            return {}

    monkeypatch.setattr(index_codebase_memory, "ParserService", FakeParserService)
    args = argparse.Namespace(
        repo=str(repo),
        db=str(tmp_path / "graph.db"),
        artifact=str(artifact),
        clear=False,
        no_recursive=False,
        exclude=[],
    )

    with pytest.raises(RuntimeError, match="requires an explicit --clear"):
        asyncio.run(index_codebase_memory.run(args))

    assert parser_called is False
    assert not artifact.exists()


def test_offline_indexer_restores_artifact_when_graph_publication_fails(
    monkeypatch, tmp_path
):
    repo = tmp_path / "repo"
    repo.mkdir()
    (repo / "source.py").write_text("VALUE = 1\n", encoding="utf-8")
    db_path = tmp_path / "graph.db"
    db_path.write_bytes(b"last-known-good-graph")
    artifact = tmp_path / "artifact.json"
    artifact.write_bytes(b"last-known-good-artifact\n")

    class FakeParserService:
        def __init__(self, **_kwargs):
            pass

        async def parse_directory(self, _request):
            _write_graph_database(
                Path(os.environ["CORTEX_DB_PATH"]), node_count=2, edge_count=1
            )
            return {
                "files_parsed": 1,
                "files_skipped": 0,
                "nodes_added": 2,
                "edges_added": 1,
                "errors": [],
                "graph": {"nodeCount": 2, "edgeCount": 1},
            }

    identity = {
        "sourceCommit": "c" * 40,
        "sourceTreeDigest": "d" * 40,
        "sourceClean": True,
    }
    monkeypatch.setattr(index_codebase_memory, "ParserService", FakeParserService)
    monkeypatch.setattr(index_codebase_memory, "source_identity", lambda _repo: identity)
    monkeypatch.setattr(
        index_codebase_memory, "artifact_staging_parent", lambda _repo, _db: tmp_path
    )
    monkeypatch.setattr(
        index_codebase_memory,
        "validate_runtime_destination",
        lambda _repo, _path, _label: None,
    )
    real_replace = index_codebase_memory.os.replace

    def fail_graph_replace(source, destination):
        if Path(destination) == db_path:
            raise OSError("simulated graph publication failure")
        return real_replace(source, destination)

    monkeypatch.setattr(index_codebase_memory.os, "replace", fail_graph_replace)
    args = argparse.Namespace(
        repo=str(repo),
        db=str(db_path),
        artifact=str(artifact),
        clear=True,
        no_recursive=False,
        exclude=[],
    )

    with pytest.raises(OSError, match="simulated graph publication failure"):
        asyncio.run(index_codebase_memory.run(args))

    assert db_path.read_bytes() == b"last-known-good-graph"
    assert artifact.read_bytes() == b"last-known-good-artifact\n"
    assert not list(tmp_path.glob(".cortex-codebase-index-*"))


def test_offline_indexer_stages_outside_real_git_source(monkeypatch, tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    (repo / "source.py").write_text("VALUE = 1\n", encoding="utf-8")
    (repo / ".gitignore").write_text(
        "/graph.db\n/artifacts/cortex-codebase-memory/\n",
        encoding="utf-8",
    )
    subprocess.run(["git", "init", "-q", str(repo)], check=True)
    subprocess.run(["git", "-C", str(repo), "add", "."], check=True)
    subprocess.run(
        [
            "git", "-C", str(repo),
            "-c", "user.name=Cortex Test",
            "-c", "user.email=cortex-test@example.invalid",
            "commit", "-qm", "fixture",
        ],
        check=True,
    )
    db_path = repo / "graph.db"
    artifact = repo / "artifacts" / "cortex-codebase-memory" / "index.json"
    staged_paths = []

    class FakeParserService:
        def __init__(self, **_kwargs):
            pass

        async def parse_directory(self, request):
            staged = Path(os.environ["CORTEX_DB_PATH"])
            staged_paths.append(staged)
            _write_graph_database(staged, node_count=2, edge_count=1)
            snapshot = codebase_source_snapshot(
                repo,
                exclude_patterns=request.exclude_patterns,
                recursive=request.recursive,
            )
            return {
                "files_parsed": snapshot["fileCount"],
                "files_skipped": 0,
                "nodes_added": 2,
                "edges_added": 1,
                "errors": [],
                "graph": {"nodeCount": 2, "edgeCount": 1},
            }

    monkeypatch.setattr(index_codebase_memory, "ParserService", FakeParserService)
    args = argparse.Namespace(
        repo=str(repo),
        db=str(db_path),
        artifact=str(artifact),
        clear=True,
        no_recursive=False,
        exclude=list(index_codebase_memory.DEFAULT_EXCLUDES),
    )

    result = asyncio.run(index_codebase_memory.run(args))

    assert result["sourceClean"] is True
    assert staged_paths and not staged_paths[0].is_relative_to(repo)
    assert db_path.exists()
    assert db_path.stat().st_mode & 0o777 == 0o600
    assert artifact.exists()
    assert subprocess.run(
        ["git", "-C", str(repo), "status", "--porcelain=v1"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout == ""


def test_offline_indexer_cli_completes_with_real_parser(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    (repo / "source.py").write_text(
        "def helper():\n    return 1\n",
        encoding="utf-8",
    )
    (repo / ".gitignore").write_text(
        "/graph.db\n/index.json\n",
        encoding="utf-8",
    )
    subprocess.run(["git", "init", "-q", str(repo)], check=True)
    subprocess.run(["git", "-C", str(repo), "add", "."], check=True)
    subprocess.run(
        [
            "git", "-C", str(repo),
            "-c", "user.name=Cortex Test",
            "-c", "user.email=cortex-test@example.invalid",
            "commit", "-qm", "fixture",
        ],
        check=True,
    )
    db_path = repo / "graph.db"
    artifact = repo / "index.json"
    environment = os.environ.copy()
    environment.update({
        "HOME": str(tmp_path / "home"),
        "CORTEX_DB_PATH": str(tmp_path / "ambient-must-not-be-used.db"),
        "PYTHONDONTWRITEBYTECODE": "1",
    })

    completed = subprocess.run(
        [
            sys.executable,
            str(Path(index_codebase_memory.__file__)),
            str(repo),
            "--db", str(db_path),
            "--artifact", str(artifact),
            "--clear",
        ],
        cwd=Path(index_codebase_memory.__file__).resolve().parents[1],
        env=environment,
        check=True,
        capture_output=True,
        text=True,
        timeout=15,
    )
    summary = json.loads(completed.stdout)

    assert summary["graph"]["nodeCount"] > 0
    assert summary["graph"]["edgeCount"] > 0
    assert summary["sourceClean"] is True
    assert artifact.exists()
    assert db_path.stat().st_mode & 0o777 == 0o600


def test_sqlite_storage_reopens_after_atomic_graph_replacement(tmp_path):
    graph_path = tmp_path / "graph.db"
    storage = SQLiteStorage(str(graph_path))
    connection = sqlite3.connect(graph_path)
    try:
        connection.executemany(
            "INSERT INTO nodes "
            "(id, type, name, created_at, updated_at, metadata) "
            "VALUES (?, 'Module', ?, '2026-08-23T00:00:00', "
            "'2026-08-23T00:00:00', '{}')",
            [("node-1", "one"), ("node-2", "two")],
        )
        connection.execute(
            "INSERT INTO edges "
            "(id, type, source_id, target_id, metadata) "
            "VALUES ('edge-1', 'Imports', 'node-1', 'node-2', '{}')"
        )
        connection.commit()
    finally:
        connection.close()
    assert storage.stats()["nodeCount"] == 2

    replacement = tmp_path / "replacement.db"
    replacement.write_bytes(graph_path.read_bytes())
    connection = sqlite3.connect(replacement)
    try:
        connection.execute(
            "INSERT INTO nodes "
            "(id, type, name, created_at, updated_at, metadata) "
            "VALUES ('node-3', 'Module', 'three', '2026-08-23T00:00:00', "
            "'2026-08-23T00:00:00', '{}')"
        )
        connection.execute(
            "INSERT INTO edges "
            "(id, type, source_id, target_id, metadata) "
            "VALUES ('edge-2', 'Imports', 'node-2', 'node-3', '{}')"
        )
        connection.commit()
    finally:
        connection.close()
    os.replace(replacement, graph_path)

    assert storage.stats()["nodeCount"] == 3
    assert storage.stats()["edgeCount"] == 2
    storage.close()


def test_offline_graph_publication_refuses_active_serving_handle(tmp_path):
    graph_path = tmp_path / "graph.db"
    storage = SQLiteStorage(str(graph_path))
    try:
        with pytest.raises(RuntimeError, match="serving graph handles"):
            index_codebase_memory.acquire_offline_publication_lock(graph_path)
    finally:
        storage.close()

    descriptor = index_codebase_memory.acquire_offline_publication_lock(graph_path)
    assert descriptor is not None
    os.close(descriptor)


def test_governance_health_hashes_canonical_files_and_replays_canaries(
    monkeypatch, tmp_path
):
    workspace = tmp_path / "clawd"
    projects = workspace / "memory" / "projects"
    projects.mkdir(parents=True)
    index = projects / "INDEX.md"
    canonical = projects / "alpha.md"
    secret_content = "canonical fact that must not appear in health output\n"
    canonical.write_text(secret_content, encoding="utf-8")
    index.write_text(
        "| Project | Canonical file |\n"
        "| --- | --- |\n"
        "| Alpha | `memory/projects/alpha.md` |\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(librarian, "_CANONICAL_PROJECT_INDEX", index)

    healthy = knowledge._memory_governance_health()

    assert healthy["configured"] is True
    assert healthy["available"] is True
    assert healthy["verified"] is True
    assert healthy["governanceCanary"] == {
        "ok": True,
        "precedenceConflictVerified": True,
        "recoveryTransitionVerified": True,
        "durableWritesPerformed": False,
    }
    alpha = next(
        row for row in healthy["canonicalManifest"] if row["path"].endswith("alpha.md")
    )
    assert alpha["authority"] == "canonical_project_file"
    assert alpha["sha256"] == hashlib.sha256(secret_content.encode()).hexdigest()
    assert secret_content.strip() not in json.dumps(healthy)

    canonical.unlink()
    missing = knowledge._memory_governance_health()
    assert missing["configured"] is True
    assert missing["available"] is False
    assert missing["verified"] is False
    assert "memory/projects/alpha.md" in missing["missingCanonicalFiles"]


def test_governance_health_fails_closed_on_malformed_mapping_row(
    monkeypatch, tmp_path
):
    workspace = tmp_path / "clawd"
    projects = workspace / "memory" / "projects"
    projects.mkdir(parents=True)
    index = projects / "INDEX.md"
    (projects / "alpha.md").write_text("canonical alpha\n", encoding="utf-8")
    (projects / "beta.md").write_text("canonical beta\n", encoding="utf-8")
    index.write_text(
        "| Project | Canonical file |\n"
        "| --- | --- |\n"
        "| Alpha | `memory/projects/alpha.md` |\n"
        "| Beta | memory/projects/beta.md |\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(librarian, "_CANONICAL_PROJECT_INDEX", index)

    result = knowledge._memory_governance_health()

    assert result["configured"] is True
    assert result["available"] is False
    assert result["verified"] is False
    assert result["canonicalMappingCount"] == 1
    assert result["canonicalMappingParseVerified"] is False
    assert result["canonicalMappingErrors"] == [
        "line 4: canonical mapping path must be backtick-delimited"
    ]


def test_governance_health_keeps_malformed_registry_configured(
    monkeypatch, tmp_path
):
    workspace = tmp_path / "clawd"
    projects = workspace / "memory" / "projects"
    projects.mkdir(parents=True)
    index = projects / "INDEX.md"
    index.write_text(
        "| Project | Canonical file |\n"
        "| --- | --- |\n"
        "| Alpha | memory/projects/alpha.md |\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(librarian, "_CANONICAL_PROJECT_INDEX", index)

    result = knowledge._memory_governance_health()

    assert result["configured"] is True
    assert result["available"] is False
    assert result["verified"] is False
    assert result["canonicalMappingCount"] == 0
    assert result["canonicalMappingParseVerified"] is False


def test_governance_health_rejects_conflicting_canonical_aliases(
    monkeypatch, tmp_path
):
    workspace = tmp_path / "clawd"
    projects = workspace / "memory" / "projects"
    projects.mkdir(parents=True)
    index = projects / "INDEX.md"
    (projects / "alpha.md").write_text("alpha\n", encoding="utf-8")
    (projects / "beta.md").write_text("beta\n", encoding="utf-8")
    index.write_text(
        "| Project | Canonical file |\n"
        "| --- | --- |\n"
        "| Alpha | `memory/projects/alpha.md` |\n"
        "| alpha | `memory/projects/beta.md` |\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(librarian, "_CANONICAL_PROJECT_INDEX", index)

    result = knowledge._memory_governance_health()

    assert result["ok"] is False
    assert result["canonicalMappingParseVerified"] is False
    assert result["canonicalMappingErrors"] == [
        "line 4: canonical alias conflicts with line 3"
    ]


def test_governance_health_rejects_symlinked_canonical_ancestry(
    monkeypatch, tmp_path
):
    workspace = tmp_path / "clawd"
    projects = workspace / "memory" / "projects"
    projects.mkdir(parents=True)
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "outside.md").write_text("external claim\n", encoding="utf-8")
    (projects / "linked").symlink_to(outside, target_is_directory=True)
    index = projects / "INDEX.md"
    index.write_text(
        "| Project | Canonical file |\n"
        "| --- | --- |\n"
        "| Alpha | `memory/projects/linked/outside.md` |\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(librarian, "_CANONICAL_PROJECT_INDEX", index)

    result = knowledge._memory_governance_health()

    assert result["ok"] is False
    linked = next(
        row
        for row in result["canonicalManifest"]
        if row["path"].endswith("linked/outside.md")
    )
    assert linked["verified"] is False
    assert "symlink ancestor" in linked["error"]


def test_legacy_store_inventory_fails_closed_on_present_unverified_path(
    monkeypatch, tmp_path
):
    legacy = tmp_path / "legacy.jsonl"
    monkeypatch.setattr(knowledge, "_LEGACY_MEMORY_STORE_PATHS", [legacy])

    absent = knowledge._legacy_memory_store_health()
    assert absent["ok"] is True
    assert absent["verified"] is True

    legacy.write_text('{"unverified": true}\n', encoding="utf-8")
    present = knowledge._legacy_memory_store_health()
    assert present["ok"] is False
    assert present["verified"] is False
    assert present["existingUnverifiedStores"] == [str(legacy)]

    legacy.unlink()
    legacy.symlink_to(tmp_path / "missing-target")
    dangling = knowledge._legacy_memory_store_health()
    assert dangling["ok"] is False
    assert dangling["verified"] is False
    assert dangling["stores"][0]["exists"] is True
    assert dangling["stores"][0]["symlink"] is True


def test_durable_file_health_separates_inventory_from_unverified_policy_claims(
    monkeypatch, tmp_path
):
    durable = tmp_path / "memory"
    project = durable / "projects" / "alpha.md"
    project.parent.mkdir(parents=True)
    project.write_text("durable fact\n", encoding="utf-8")
    monkeypatch.setattr(knowledge, "_DEFAULT_DURABLE_MEMORY_ROOTS", [durable])

    present = knowledge._durable_file_memory_health()
    assert present["configured"] is True
    assert present["available"] is True
    assert present["verified"] is True
    assert present["fileCount"] == 1
    assert present["projectFileCount"] == 1
    assert present["semanticFreshnessVerified"] is False
    assert present["retentionPolicyVerified"] is False
    assert present["permissionPolicyVerified"] is False

    project.unlink()
    project.parent.rmdir()
    durable.rmdir()
    absent = knowledge._durable_file_memory_health()
    assert absent["configured"] is True
    assert absent["available"] is False
    assert absent["verified"] is False


def test_durable_file_health_fails_closed_when_a_subtree_cannot_be_enumerated(
    monkeypatch, tmp_path
):
    durable = tmp_path / "memory"
    blocked = durable / "blocked"
    blocked.mkdir(parents=True)
    (durable / "visible.md").write_text("visible fact\n", encoding="utf-8")
    (blocked / "hidden.md").write_text("hidden fact\n", encoding="utf-8")
    monkeypatch.setattr(knowledge, "_DEFAULT_DURABLE_MEMORY_ROOTS", [durable])
    real_scandir = knowledge.os.scandir

    def guarded_scandir(path):
        if Path(path) == blocked:
            raise PermissionError("blocked inventory subtree")
        return real_scandir(path)

    monkeypatch.setattr(knowledge.os, "scandir", guarded_scandir)

    result = knowledge._durable_file_memory_health()

    assert result["configured"] is True
    assert result["available"] is True
    assert result["verified"] is False
    assert result["fileCount"] == 1
    assert result["scanErrors"] == [
        {
            "path": str(blocked),
            "error": "PermissionError: blocked inventory subtree",
        }
    ]
