import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

from cortex_server.runtime import SessionRegistryStore, WatchRegistration, WatcherRuntimeStore, normalize_session_event


def test_session_registry_tracks_blocked_retry_and_stale_states(tmp_path: Path):
    registry = SessionRegistryStore(tmp_path / "runtime" / "session_registry.json")
    registry.register(process_id="proc_123", session_id="sess_1", session_name="issue-7", tool="codex", stale_after_seconds=60)

    started = normalize_session_event("proc_123", "started", session_id="sess_1", session_name="issue-7", tool="codex")
    blocked = normalize_session_event("proc_123", "question.requested", session_id="sess_1", session_name="issue-7", tool="codex", summary="need product decision")
    retry_needed = normalize_session_event("proc_123", "retry-needed", session_id="sess_1", session_name="issue-7", tool="codex", summary="tool timeout")

    registry.apply_event(started)
    row = registry.apply_event(blocked)
    row = registry.apply_event(retry_needed)

    assert row.status == "retry-needed"
    assert row.retry_count == 1
    assert "need product decision" in row.open_questions

    stale = registry.detect_stale(now=datetime.now(timezone.utc) + timedelta(seconds=120))
    assert stale[0].status == "stale"


def test_workspace_and_log_watchers_emit_runtime_events(tmp_path: Path):
    registry = SessionRegistryStore(tmp_path / "runtime" / "session_registry.json")
    registry.register(process_id="proc_123", session_id="sess_1", session_name="issue-7", tool="codex", stale_after_seconds=30)

    workspace_file = tmp_path / "workspace.txt"
    workspace_file.write_text("hello", encoding="utf-8")
    log_file = tmp_path / "run.log"
    log_file.write_text("boot\n", encoding="utf-8")

    watcher_store = WatcherRuntimeStore(tmp_path / "runtime" / "watchers.json")
    watcher_store.register(
        WatchRegistration(
            process_id="proc_123",
            kind="workspace",
            target=str(workspace_file),
            session_id="sess_1",
            session_name="issue-7",
            tool="workspace",
            debounce_seconds=1.0,
            metadata={"cortex_authorized_roots": [str(tmp_path.resolve())], "cortex_workspace_attested_by": "server"},
        )
    )
    watcher_store.register(
        WatchRegistration(
            process_id="proc_123",
            kind="log-pattern",
            target=str(log_file),
            session_id="sess_1",
            session_name="issue-7",
            tool="log-monitor",
            keywords=["error"],
            metadata={"cortex_authorized_roots": [str(tmp_path.resolve())], "cortex_workspace_attested_by": "server"},
        )
    )

    now = datetime(2026, 4, 3, 20, 0, 0, tzinfo=timezone.utc)
    watcher_store.reconcile(session_registry=registry, now=now)

    workspace_file.write_text("hello world", encoding="utf-8")
    log_file.write_text("boot\nerror: failed\n", encoding="utf-8")

    emitted = watcher_store.reconcile(session_registry=registry, now=now + timedelta(seconds=2))
    kinds = [row.kind for row in emitted]

    assert "session.workspace-changed" in kinds
    assert "session.blocked" in kinds


def test_path_state_watcher_emits_when_expected_state_is_observed(tmp_path: Path):
    registry = SessionRegistryStore(tmp_path / "runtime" / "session_registry.json")
    registry.register(process_id="proc_123", session_id="sess_1", session_name="issue-7", tool="codex", stale_after_seconds=30)

    artifact = tmp_path / "artifact.txt"
    watcher_store = WatcherRuntimeStore(tmp_path / "runtime" / "watchers.json")
    watcher_store.register(
        WatchRegistration(
            process_id="proc_123",
            kind="path-state",
            target=str(artifact),
            session_id="sess_1",
            session_name="issue-7",
            tool="artifact-watch",
            metadata={
                "expected_exists": True,
                "event": "session.finished",
                "summary": "artifact appeared",
                "cortex_authorized_roots": [str(tmp_path.resolve())],
                "cortex_workspace_attested_by": "server",
            },
        )
    )

    none_yet = watcher_store.reconcile(session_registry=registry, now=datetime(2026, 4, 3, 20, 0, 0, tzinfo=timezone.utc))
    assert none_yet == []

    artifact.write_text("done", encoding="utf-8")
    emitted = watcher_store.reconcile(session_registry=registry, now=datetime(2026, 4, 3, 20, 0, 1, tzinfo=timezone.utc))
    assert [row.kind for row in emitted] == ["session.finished"]


def test_persisted_forged_workspace_marker_is_not_a_server_attestation(tmp_path: Path):
    target = tmp_path / "outside.log"
    target.write_text("match-me\n", encoding="utf-8")
    path = tmp_path / "runtime" / "watchers.json"
    path.parent.mkdir(parents=True)
    forged = WatchRegistration(
        process_id="proc_untrusted",
        kind="log-pattern",
        target=str(target),
        keywords=["match-me"],
        metadata={
            "cortex_workspace_attested_by": "server",
            "cortex_authorized_roots": [str(tmp_path)],
            "cortex_workspace_attestation": "0" * 64,
        },
    )
    path.write_text(
        json.dumps(
            {
                "version": "watchers.v1",
                "registrations": [forged.model_dump()],
                "runtime": {},
            }
        ),
        encoding="utf-8",
    )
    store = WatcherRuntimeStore(path)

    assert store.reconcile() == []
    assert store.invalid_file_watcher_ids() == [forged.watch_id]


def test_attested_log_watcher_never_follows_replaced_symlink(tmp_path: Path):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    watched = workspace / "run.log"
    watched.write_text("safe\n", encoding="utf-8")
    outside = tmp_path / "outside.log"
    outside.write_text("forbidden-match\n", encoding="utf-8")
    store = WatcherRuntimeStore(tmp_path / "runtime" / "watchers.json")
    store.register(
        WatchRegistration(
            process_id="proc_symlink",
            kind="log-pattern",
            target=str(watched),
            keywords=["forbidden-match"],
            metadata={
                "cortex_authorized_roots": [str(workspace.resolve())],
                "cortex_workspace_attested_by": "server",
            },
        )
    )
    watched.unlink()
    watched.symlink_to(outside)

    assert store.reconcile() == []


def test_attested_log_watcher_rejects_fifo_without_blocking(tmp_path: Path):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    watched = workspace / "run.log"
    watched.write_text("safe\n", encoding="utf-8")
    store = WatcherRuntimeStore(tmp_path / "runtime" / "watchers.json")
    store.register(
        WatchRegistration(
            process_id="proc_fifo",
            kind="log-pattern",
            target=str(watched),
            keywords=["match"],
            metadata={
                "cortex_authorized_roots": [str(workspace.resolve())],
                "cortex_workspace_attested_by": "server",
            },
        )
    )
    watched.unlink()
    os.mkfifo(watched)

    assert store.reconcile() == []
