from services.world_state.update_pipeline import apply_events
from services.modulation.policy_runtime import modulation_state_from_observations
from services.modulation.adaptive_depth_controller import choose_reasoning_profile
from services.workspace.arbitration_engine import choose_specialist
from services.workspace.broadcast_policy import select_broadcast_payload
from services.truth_engine.calibration_model import calibrate_confidence
from services.truth_engine.pre_send_guard import guard_output


def test_r1_world_state_pipeline_merges_events_deterministically():
    events = [
        {'entity_id': 'svc', 'kind': 'service', 'state': {'status': 'ok'}, 'confidence': 0.8, 'provenance': [{'source': 'probe'}]},
        {'entity_id': 'svc', 'kind': 'service', 'state': {'latency_ms': 10}, 'confidence': 0.9, 'provenance': [{'source': 'probe2'}]},
    ]
    snapshot = apply_events(events)
    assert snapshot['entities']['svc']['state']['status'] == 'ok'
    assert snapshot['entities']['svc']['state']['latency_ms'] == 10
    assert snapshot['entities']['svc']['confidence'] == 0.9


def test_r3_modulation_profile_scales_depth():
    state = modulation_state_from_observations(salience=0.9, novelty=0.8, uncertainty=0.7, urgency=0.5)
    profile = choose_reasoning_profile(state)
    assert profile['reasoning_depth'] >= 4
    assert profile['deep_reasoning_required'] is True


def test_r4_workspace_arbitration_and_broadcast():
    result = choose_specialist([
        {'name': 'planner', 'priority': 0.8, 'confidence': 0.7},
        {'name': 'retriever', 'priority': 0.7, 'confidence': 0.9},
    ])
    broadcast = select_broadcast_payload([
        {'topic': 'goal', 'salience': 0.9},
        {'topic': 'idle', 'salience': 0.2},
    ])
    assert result['selected'] == 'planner'
    assert len(result['trace']) == 2
    assert [row['topic'] for row in broadcast] == ['goal']


def test_r6_truth_engine_blocks_contradictions_and_calibrates():
    confidence = calibrate_confidence(0.7, evidence_count=2, contradiction_count=1)
    guard = guard_output(claims=[{'claim_id': 'c1', 'evidence': ['e1'], 'contradiction_count': 1}])
    assert confidence < 0.7
    assert guard['action'] == 'block'
