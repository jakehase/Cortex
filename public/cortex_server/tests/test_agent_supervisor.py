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
    trusted_now = [datetime.now(timezone.utc)]
    supervisor = AgentSupervisor(
        tmp_path / "runtime" / "leases.json",
        clock_fn=lambda: trusted_now[0],
    )

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

    trusted_now[0] += timedelta(seconds=180)
    stale = supervisor.reclaim_stale(process_id="proc_123")
    assert len(stale) == 1
    assert stale[0].status == "stale"

    released = supervisor.release(lease.lease_id)
    assert released.status == "released"


def test_reclaim_stale_uses_trusted_clock_and_is_process_scoped(tmp_path: Path):
    observed_now = datetime.now(timezone.utc)
    trusted_now = [observed_now]
    supervisor = AgentSupervisor(
        tmp_path / "runtime" / "leases.json",
        clock_fn=lambda: trusted_now[0],
    )
    first = supervisor.assign(
        process_id="proc_first",
        scope="worker",
        agent_id="first",
        lease_seconds=1,
    )
    second = supervisor.assign(
        process_id="proc_second",
        scope="worker",
        agent_id="second",
        lease_seconds=1,
    )
    trusted_now[0] = observed_now + timedelta(seconds=2)

    reclaimed = supervisor.reclaim_stale(process_id="proc_first")

    assert [row.lease_id for row in reclaimed] == [first.lease_id]
    assert supervisor.list(process_id="proc_first")[0].status == "stale"
    assert supervisor.list(process_id="proc_second")[0].lease_id == second.lease_id
    assert supervisor.list(process_id="proc_second")[0].status == "active"


def test_promotion_snapshot_projects_near_expiry_lease_as_stale(tmp_path: Path):
    trusted_now = [datetime.now(timezone.utc)]
    supervisor = AgentSupervisor(
        tmp_path / "runtime" / "leases.json",
        clock_fn=lambda: trusted_now[0],
    )
    lease = supervisor.assign(
        process_id="proc_release",
        scope="release:production",
        agent_id="release-manager",
        lease_seconds=5,
    )
    trusted_now[0] += timedelta(seconds=4, milliseconds=500)

    with supervisor.promotion_snapshot(
        process_id="proc_release",
        minimum_remaining_seconds=1,
    ) as (_, leases):
        projected = next(row for row in leases if row.lease_id == lease.lease_id)
        assert projected.status == "stale"


def test_stale_takeover_persists_new_generation_and_fences_old_heartbeat(tmp_path: Path):
    trusted_now = [datetime.now(timezone.utc)]
    supervisor = AgentSupervisor(
        tmp_path / "runtime" / "leases.json",
        clock_fn=lambda: trusted_now[0],
    )
    old = supervisor.assign(
        process_id="proc_takeover",
        scope="worker",
        agent_id="worker-a",
        lease_seconds=1,
    )
    trusted_now[0] += timedelta(seconds=2)
    supervisor.reclaim_stale(process_id="proc_takeover")

    superseded, successor = supervisor.takeover_stale(
        old.lease_id,
        agent_id="worker-b",
        lease_seconds=30,
    )

    assert superseded.status == "superseded"
    assert successor.generation == old.generation + 1
    assert successor.metadata["takeover_of_lease_id"] == old.lease_id
    with pytest.raises(RuntimeError, match="non-active"):
        supervisor.heartbeat(old.lease_id)



def test_agent_supervisor_rejects_bad_inputs_and_missing_leases(tmp_path: Path):
    supervisor = AgentSupervisor(tmp_path / "runtime" / "leases.json")

    with pytest.raises(ValueError):
        supervisor.assign(process_id="proc_123", scope="step1", agent_id="planner", lease_seconds=0)

    with pytest.raises(KeyError):
        supervisor.heartbeat("lease_missing")

    with pytest.raises(ValidationError):
        supervisor.assign(process_id="", scope="step1", agent_id="planner", lease_seconds=30)



def test_agent_supervisor_blocks_duplicate_active_claims_and_reuses_same_agent_claim(tmp_path: Path):
    trusted_now = [datetime.now(timezone.utc)]
    supervisor = AgentSupervisor(
        tmp_path / "runtime" / "leases.json",
        clock_fn=lambda: trusted_now[0],
    )

    first = supervisor.assign(process_id="proc_123", scope="step1", agent_id="planner", lease_seconds=60)
    same = supervisor.assign(process_id="proc_123", scope="step1", agent_id="planner", lease_seconds=60)

    assert same.lease_id == first.lease_id

    with pytest.raises(ValueError, match="active claim exists"):
        supervisor.assign(process_id="proc_123", scope="step1", agent_id="researcher", lease_seconds=60)

    trusted_now[0] += timedelta(seconds=180)
    supervisor.reclaim_stale(process_id="proc_123")
    replacement = supervisor.assign(process_id="proc_123", scope="step1", agent_id="researcher", lease_seconds=60)
    assert replacement.agent_id == "researcher"



def test_agent_supervisor_can_resolve_stale_leases_with_metadata(tmp_path: Path):
    trusted_now = [datetime.now(timezone.utc)]
    supervisor = AgentSupervisor(
        tmp_path / "runtime" / "leases.json",
        clock_fn=lambda: trusted_now[0],
    )

    lease = supervisor.assign(process_id="proc_123", scope="step1", agent_id="planner", lease_seconds=1)
    trusted_now[0] += timedelta(seconds=10)
    supervisor.reclaim_stale(process_id="proc_123")
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
