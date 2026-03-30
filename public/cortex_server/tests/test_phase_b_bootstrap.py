from services.plasticity.replay_scheduler import schedule_replay
from services.plasticity.continual_eval import continual_eval_matrix
from services.plasticity.forgetting_alerts import forgetting_alert


def test_r2_replay_scheduler_prefers_anchors_then_priority():
    rows = schedule_replay([
        {'sample_id': 'novel', 'anchor': False, 'priority': 0.9, 'recency': 0.8},
        {'sample_id': 'anchor', 'anchor': True, 'priority': 0.6, 'recency': 0.1},
    ])
    assert rows[0]['sample_id'] == 'anchor'


def test_r2_continual_eval_and_forgetting_alert():
    metrics = continual_eval_matrix(retain=0.9, transfer=1.15, forget=0.1)
    alert = forgetting_alert(metrics, retention_floor=0.95)
    assert metrics['forward_transfer_gain'] == 0.15
    assert alert['alert'] is True
    assert 'retention_regression' in alert['reasons']
