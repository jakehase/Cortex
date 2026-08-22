# R3 — Neuromodulation layer

## Objective
Implement artificial modulation signals (salience, novelty, uncertainty, urgency) that steer retrieval depth and learning rate.

## Phase
Phase A/B bridge (0-12 weeks)

## Build-now track (4-12 weeks)
### Milestones
- Define modulation signal contract and bounded ranges.
- Add runtime modulation policy hook into retrieval/planning paths.
- Implement adaptive depth/effort controller driven by modulation state.
- Add safety limits to prevent runaway over-focus or under-response.

### Deliverables
- `services/modulation/signal_schema.json`
- `services/modulation/policy_runtime.py`
- `services/modulation/adaptive_depth_controller.py`
- `services/modulation/safety_bounds.json`

### Metrics
- `high_salience_recall_gain` target: **>=15%**
- `unnecessary_deep_reasoning_rate` target: **<=20%**
- `modulation_stability_failures` target: **0 critical**

## Research track (12-30+ weeks)
### Open questions
- How can modulation be personalized without destabilizing global behavior?
- Which modulation combinations best predict task-critical uncertainty?

### Research milestones
- Define hypothesis suite and evaluation protocol.
- Run controlled experiments and collect failure modes.
- Publish reproducibility package and external benchmark comparisons.

## Dependencies
- Requires: R6
- Unlocks: R2, R7

## Execution
```bash
python3 /root/.openclaw/workspace/scripts/cortex_r3_neuromodulation_layer.py
```
