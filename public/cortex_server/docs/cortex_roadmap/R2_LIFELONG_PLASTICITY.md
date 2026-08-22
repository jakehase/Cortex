# R2 — Lifelong plasticity without forgetting

## Objective
Enable continual learning where new knowledge updates policies without catastrophic forgetting of prior anchors.

## Phase
Phase B (8-16 weeks learning stability)

## Build-now track (8-16 weeks)
### Milestones
- Introduce replay-buffer scheduler with anchor-priority weighting.
- Add consolidation policy that protects high-confidence long-term anchors.
- Implement continual-update evaluator (retain/transfer/forget matrix).
- Create catastrophic-forgetting alert and rollback trigger.

### Deliverables
- `services/plasticity/replay_scheduler.py`
- `services/plasticity/anchor_protection_policy.json`
- `services/plasticity/continual_eval.py`
- `services/plasticity/forgetting_alerts.py`

### Metrics
- `retention_regression_after_update` target: **<=5%**
- `forward_transfer_gain` target: **>=10%**
- `anchor_violation_count` target: **0**

## Research track (16-36+ weeks)
### Open questions
- What replay strategy best preserves old skills under rapid domain shifts?
- How to tune plasticity to avoid over-constraining adaptation?

### Research milestones
- Define hypothesis suite and evaluation protocol.
- Run controlled experiments and collect failure modes.
- Publish reproducibility package and external benchmark comparisons.

## Dependencies
- Requires: R1, R3, R6
- Unlocks: R5

## Execution
```bash
python3 /root/.openclaw/workspace/scripts/cortex_r2_lifelong_plasticity.py
```
