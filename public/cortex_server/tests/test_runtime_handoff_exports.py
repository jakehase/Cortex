from __future__ import annotations

from cortex_server.runtime import HandoffArtifactRef, HandoffContract, HandoffEvidenceRef



def test_runtime_package_exports_handoff_contract_types():
    assert HandoffContract is not None
    assert HandoffEvidenceRef is not None
    assert HandoffArtifactRef is not None
