from __future__ import annotations

import pytest

from cortex_server.runtime import HandoffArtifactRef, HandoffContract, HandoffEvidenceRef
from cortex_server.runtime.handoff_contract import ValidationError



def test_handoff_contract_round_trip_contains_expected_fields():
    contract = HandoffContract(
        process_id="proc_123",
        from_agent="coordinator",
        to_agent="researcher",
        source_revision="rev_7",
        objective="Validate the degraded service incident and collect confirming evidence",
        assumptions=["The service status may be stale", "Use the latest world-state revision"],
        relevant_evidence=[
            HandoffEvidenceRef(ref_id="claim-1", summary="service degraded", confidence=0.72),
        ],
        relevant_artifacts=[
            HandoffArtifactRef(artifact_id="artifact-1", path="artifacts/incidents/step1.json", summary="incident packet"),
        ],
        open_questions=["Is the failure isolated to one service?"],
        expected_output="Return a revised incident assessment with evidence refs and confidence notes",
        timeout_seconds=900,
        lease_seconds=600,
        metadata={"priority": "high"},
    )

    dumped = contract.model_dump() if hasattr(contract, "model_dump") else contract.dict()

    assert dumped["process_id"] == "proc_123"
    assert dumped["from_agent"] == "coordinator"
    assert dumped["to_agent"] == "researcher"
    assert dumped["relevant_evidence"][0]["ref_id"] == "claim-1"
    assert dumped["relevant_artifacts"][0]["artifact_id"] == "artifact-1"
    assert dumped["open_questions"] == ["Is the failure isolated to one service?"]
    assert dumped["expected_output"].startswith("Return a revised incident assessment")



def test_handoff_contract_rejects_missing_required_fields_and_bad_durations():
    with pytest.raises(ValidationError):
        HandoffContract(
            process_id="",
            from_agent="coordinator",
            to_agent="researcher",
            source_revision="rev_7",
            objective="Investigate",
            expected_output="Report back",
        )

    with pytest.raises(ValidationError):
        HandoffContract(
            process_id="proc_123",
            from_agent="coordinator",
            to_agent="researcher",
            source_revision="rev_7",
            objective="Investigate",
            expected_output="Report back",
            timeout_seconds=0,
        )

    with pytest.raises(ValidationError):
        HandoffContract(
            process_id="proc_123",
            from_agent="coordinator",
            to_agent="researcher",
            source_revision="rev_7",
            objective="Investigate",
            expected_output="Report back",
            assumptions=["", "valid"],
        )



def test_handoff_reference_models_validate_non_empty_ids():
    with pytest.raises(ValidationError):
        HandoffEvidenceRef(ref_id="")

    with pytest.raises(ValidationError):
        HandoffArtifactRef(artifact_id="")
