from __future__ import annotations

from datetime import datetime, timedelta, timezone
import json
import multiprocessing
from pathlib import Path

import pytest

from cortex_server.runtime import AgentSupervisor
from cortex_server.runtime.agent_supervisor import ValidationError


def _assign_concurrent_lease(path: str, index: int, start) -> None:
    start.wait(timeout=10)
    AgentSupervisor(path).assign(
        process_id=f"proc_{index}",
        scope=f"scope_{index}",
        agent_id=f"agent_{index}",
        lease_seconds=60,
    )



def test_agent_supervisor_assign_heartbeat_release_and_reclaim(tmp_path: Path):
    supervisor = AgentSupervisor(tmp_path / "runtime" / "leases.json")

    lease = supervisor.assign(
        process_id="proc_123",
        scope="step1",
        agent_id="planner",
        lease_seconds=60,
        metadata={"priority": "high"},
    )

    assert lease.status == "active"
    assert lease.process_id == "proc_123"
    assert lease.agent_id == "planner"

    heartbeated = supervisor.heartbeat(lease.lease_id, lease_seconds=120)
    assert heartbeated.status == "active"
    assert heartbeated.heartbeat_at is not None

    active = supervisor.list(process_id="proc_123", status="active")
    assert len(active) == 1
    assert active[0].lease_id == lease.lease_id

    stale = supervisor.reclaim_stale(now=datetime.now(timezone.utc) + timedelta(seconds=180))
    assert len(stale) == 1
    assert stale[0].status == "stale"

    released = supervisor.release(lease.lease_id)
    assert released.status == "released"



def test_agent_supervisor_rejects_bad_inputs_and_missing_leases(tmp_path: Path):
    supervisor = AgentSupervisor(tmp_path / "runtime" / "leases.json")

    with pytest.raises(ValueError):
        supervisor.assign(process_id="proc_123", scope="step1", agent_id="planner", lease_seconds=0)

    with pytest.raises(KeyError):
        supervisor.heartbeat("lease_missing")

    with pytest.raises(ValidationError):
        supervisor.assign(process_id="", scope="step1", agent_id="planner", lease_seconds=30)



def test_agent_supervisor_blocks_duplicate_active_claims_and_reuses_same_agent_claim(tmp_path: Path):
    supervisor = AgentSupervisor(tmp_path / "runtime" / "leases.json")

    first = supervisor.assign(process_id="proc_123", scope="step1", agent_id="planner", lease_seconds=60)
    same = supervisor.assign(process_id="proc_123", scope="step1", agent_id="planner", lease_seconds=60)

    assert same.lease_id == first.lease_id

    with pytest.raises(ValueError, match="active claim exists"):
        supervisor.assign(process_id="proc_123", scope="step1", agent_id="researcher", lease_seconds=60)

    supervisor.reclaim_stale(now=datetime.now(timezone.utc) + timedelta(seconds=180))
    replacement = supervisor.assign(process_id="proc_123", scope="step1", agent_id="researcher", lease_seconds=60)
    assert replacement.agent_id == "researcher"



def test_agent_supervisor_can_resolve_stale_leases_with_metadata(tmp_path: Path):
    supervisor = AgentSupervisor(tmp_path / "runtime" / "leases.json")

    lease = supervisor.assign(process_id="proc_123", scope="step1", agent_id="planner", lease_seconds=1)
    supervisor.reclaim_stale(now=datetime.now(timezone.utc) + timedelta(seconds=10))
    resolved = supervisor.resolve(lease.lease_id, status="released", metadata={"resolution": "watchdog_recovered"})

    assert resolved.status == "released"
    assert resolved.metadata["resolution"] == "watchdog_recovered"


def test_agent_supervisor_multiprocess_updates_are_lossless_and_revisioned(tmp_path: Path):
    path = tmp_path / "runtime" / "leases.json"
    context = multiprocessing.get_context("fork")
    start = context.Event()
    processes = [context.Process(target=_assign_concurrent_lease, args=(str(path), index, start)) for index in range(12)]
    for process in processes:
        process.start()
    start.set()
    for process in processes:
        process.join(timeout=10)
        assert process.exitcode == 0

    supervisor = AgentSupervisor(path)
    revision, leases = supervisor.list_with_revision()
    assert revision == 12
    assert {lease.process_id for lease in leases} == {f"proc_{index}" for index in range(12)}
    envelope = json.loads(path.read_text(encoding="utf-8"))
    assert envelope["version"] == "cortex.agent-leases.v2"
    assert envelope["revision"] == revision


def test_agent_supervisor_failed_replace_preserves_previous_envelope(tmp_path: Path, monkeypatch):
    path = tmp_path / "runtime" / "leases.json"
    supervisor = AgentSupervisor(path)
    supervisor.assign(process_id="proc_first", scope="scope", agent_id="first", lease_seconds=60)

    import cortex_server.runtime.agent_supervisor as supervisor_module

    monkeypatch.setattr(supervisor_module.os, "replace", lambda *_args: (_ for _ in ()).throw(OSError("replace failed")))
    with pytest.raises(OSError, match="replace failed"):
        supervisor.assign(process_id="proc_second", scope="scope", agent_id="second", lease_seconds=60)

    reopened = AgentSupervisor(path)
    revision, leases = reopened.list_with_revision()
    assert revision == 1
    assert [lease.process_id for lease in leases] == ["proc_first"]
    assert list(path.parent.glob(f".{path.name}.*.tmp")) == []
