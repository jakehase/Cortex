# R6 — Metacognitive truth engine

## Objective
Detect confabulation, calibrate uncertainty, and enforce evidence-grounded output before response emission.

## Phase
Phase A (0-8 weeks foundation)

## Build-now track (0-8 weeks)
### Milestones
- Create claim-evidence graph and provenance ledger.
- Add uncertainty calibration model and confidence bands.
- Implement confabulation detector with contradiction triggers.
- Enforce pre-send truth guard (block/clarify/fallback).

### Deliverables
- `services/truth_engine/claim_graph.py`
- `services/truth_engine/calibration_model.py`
- `services/truth_engine/confabulation_detector.py`
- `services/truth_engine/pre_send_guard.py`

### Metrics
- `contradiction_rate_per_100` target: **<=1.0**
- `calibration_ece` target: **<=0.10**
- `unsupported_claim_block_rate` target: **>=0.95**

## Research track (8-24+ weeks)
### Open questions
- How to separate true uncertainty from missing-observation uncertainty in real time?
- What formal guarantees are feasible for confabulation suppression?

### Research milestones
- Define hypothesis suite and evaluation protocol.
- Run controlled experiments and collect failure modes.
- Publish reproducibility package and external benchmark comparisons.

## Dependencies
- Requires: R4
- Unlocks: R1, R2, R3, R7

## Execution
```bash
python3 /root/.openclaw/workspace/scripts/cortex_r6_metacognitive_truth_engine.py
```
