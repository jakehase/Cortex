from __future__ import annotations

from cortex_server.modules.reasoning_contracts import (
    ConstraintDecision,
    EpistemicContext,
    EvidenceRef,
    ExplainAtom,
    GovernanceSignal,
    RuntimeConstraintSet,
    SubsystemActivation,
    model_dump_compat,
)



def test_reasoning_contracts_model_dump_round_trip_contains_expected_fields():
    evidence = EvidenceRef(kind="world_state", source="monitor", summary="service degraded", confidence=0.42)
    epistemic = EpistemicContext(
        source="world_state",
        entity_ids=["service:payments"],
        confidence=0.42,
        uncertainty=0.58,
        freshness=0.91,
        contradiction_count=0,
        provenance_strength=0.8,
        evidence_refs=[evidence],
    )
    signal = GovernanceSignal(
        source="truth_engine",
        kind="claim_guard",
        severity="high",
        blocking=True,
        recommendation="block",
        rationale="contradiction detected",
        confidence=0.88,
        evidence_refs=[evidence],
    )
    constraints = RuntimeConstraintSet(
        execution_mode="sequential",
        max_parallelism=1,
        verification_mode="strict",
        same_tick_drain=False,
        step_timeout_seconds=10.0,
        retry_max_attempts=2,
        retry_on_timeout=True,
        human_review_required=True,
        escalation_recommended=True,
        rollback_bias="strong",
    )
    explain = ExplainAtom(
        subsystem="truth_engine",
        title="Truth engine blocked emission",
        expected_effect="Prevent unsafe claim emission",
        observed_effect="Output required clarification",
        outcome="match",
        evidence_refs=[evidence],
    )
    activation = SubsystemActivation(
        subsystem="truth_engine",
        summary="Contradiction pressure active",
        epistemic_contexts=[epistemic],
        governance_signals=[signal],
        runtime_constraints=[constraints],
        explain_atoms=[explain],
    )

    dumped = model_dump_compat(activation)

    assert dumped["subsystem"] == "truth_engine"
    assert dumped["epistemic_contexts"][0]["source"] == "world_state"
    assert dumped["governance_signals"][0]["recommendation"] == "block"
    assert dumped["runtime_constraints"][0]["verification_mode"] == "strict"
    assert dumped["explain_atoms"][0]["outcome"] == "match"
    assert dumped["governance_signals"][0]["evidence_refs"][0]["summary"] == "service degraded"



def test_constraint_decision_preserves_override_trace():
    decision = ConstraintDecision(
        field="execution_mode",
        previous_value="parallel",
        chosen_value="sequential",
        decided_by="embodiment",
        rationale="pause noncritical work after intervention",
        overridden_signals=["signal_truth", "signal_modulation"],
        outcome="applied",
    )

    dumped = model_dump_compat(decision)

    assert dumped["field"] == "execution_mode"
    assert dumped["chosen_value"] == "sequential"
    assert dumped["previous_value"] == "parallel"
    assert dumped["decided_by"] == "embodiment"
    assert dumped["overridden_signals"] == ["signal_truth", "signal_modulation"]



def test_runtime_constraint_set_allows_sparse_partial_constraints():
    constraints = RuntimeConstraintSet(execution_mode="parallel", max_parallelism=3)

    dumped = model_dump_compat(constraints)

    assert dumped["execution_mode"] == "parallel"
    assert dumped["max_parallelism"] == 3
    assert dumped["verification_mode"] is None
    assert dumped["same_tick_drain"] is None
