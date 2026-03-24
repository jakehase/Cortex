# R1 — Unified self-updating world model

## Objective
Build a persistent causal world-state substrate that fuses memory, tools, and action traces into an updatable model.

## Phase
Phase A (0-8 weeks foundation)

## Build-now track (0-8 weeks)
### Milestones
- Define world-state schema v1 with provenance and confidence fields.
- Implement event-to-state update pipeline with deterministic merge policy.
- Attach causal edge builder with consistency and cycle checks.
- Expose snapshot + rollback controls for safe live operation.

### Deliverables
- `services/world_state/schema_v1.json`
- `services/world_state/update_pipeline.py`
- `services/world_state/causal_edges.jsonl`
- `services/world_state/snapshot_manager.py`

### Metrics
- `state_consistency_rate` target: **>=0.95**
- `stale_state_incidents_per_100` target: **<=3**
- `causal_link_precision` target: **>=0.80**

## Research track (8-24+ weeks)
### Open questions
- How to adapt causal structure safely under open-world novelty?
- How to infer latent causes without overfitting sparse observations?

### Research milestones
- Define hypothesis suite and evaluation protocol.
- Run controlled experiments and collect failure modes.
- Publish reproducibility package and external benchmark comparisons.

## Dependencies
- Requires: R4, R6
- Unlocks: R2, R5

## Execution
```bash
python3 /root/.openclaw/workspace/scripts/cortex_r1_unified_world_model.py
```
