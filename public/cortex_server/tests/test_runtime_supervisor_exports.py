from __future__ import annotations

from cortex_server.runtime import AgentLease, AgentSupervisor



def test_runtime_package_exports_agent_supervisor_types():
    assert AgentLease is not None
    assert AgentSupervisor is not None
