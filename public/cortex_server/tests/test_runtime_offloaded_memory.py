from pathlib import Path

from cortex_server.runtime import RuntimeMemoryStore, normalize_session_event


def test_runtime_memory_store_writes_hot_index_and_shards(tmp_path: Path):
    store = RuntimeMemoryStore(tmp_path / "memory")
    process_path = store.write_process_note(process_id="proc_123", title="Plan", note="Need to land the retry loop")
    event = normalize_session_event("proc_123", "started", tool="codex", session_id="sess_1", session_name="issue-9", summary="worker started")
    session_path = store.write_session_event(event)

    assert (tmp_path / "memory" / "MEMORY.md").exists()
    assert process_path.exists()
    assert session_path.exists()
    assert "Non-authoritative runtime notes only" in (tmp_path / "memory" / "MEMORY.md").read_text(encoding="utf-8")
    assert "authority: non-authoritative" in process_path.read_text(encoding="utf-8")
    assert "retry loop" in process_path.read_text(encoding="utf-8")
    assert "authority: non-authoritative" in session_path.read_text(encoding="utf-8")
    assert "worker started" in session_path.read_text(encoding="utf-8")
