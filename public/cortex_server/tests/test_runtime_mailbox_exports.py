from __future__ import annotations

from cortex_server.runtime import AgentMailbox, AgentMessage



def test_runtime_package_exports_agent_mailbox_types():
    assert AgentMailbox is not None
    assert AgentMessage is not None
