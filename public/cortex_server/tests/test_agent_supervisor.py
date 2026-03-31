from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from cortex_server.runtime import AgentSupervisor
from cortex_server.runtime.agent_supervisor import ValidationError



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
