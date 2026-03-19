# R5 — Grounded embodiment loop

## Objective
Establish closed-loop perception-action grounding beyond text-only cognition, starting with digital embodiment and optional robotics pilot.

## Phase
Phase C (16-24 weeks integration)

## Build-now track (16-24 weeks)
### Milestones
- Define digital sensorimotor API and event normalization layer.
- Implement closed-loop task runner with recovery policies.
- Add sim-first safety sandbox and intervention guardrails.
- Prototype robotics/edge adapter for real-world action channels.

### Deliverables
- `services/embodiment/sensorimotor_api.json`
- `services/embodiment/closed_loop_runner.py`
- `services/embodiment/sim_safety_sandbox.py`
- `services/embodiment/robotics_adapter.md`

### Metrics
- `closed_loop_task_completion_rate` target: **>=0.75**
- `recovery_after_sensor_noise` target: **>=0.80**
- `safety_intervention_rate` target: **<=0.05**

## Research track (24-48+ weeks)
### Open questions
- How to achieve robust sim-to-real transfer without unsafe policy drift?
- What embodiment abstractions preserve reasoning fidelity across modalities?

### Research milestones
- Define hypothesis suite and evaluation protocol.
- Run controlled experiments and collect failure modes.
- Publish reproducibility package and external benchmark comparisons.

## Dependencies
- Requires: R1, R4, R7
- Unlocks: None

## Execution
```bash
python3 /root/.openclaw/workspace/scripts/cortex_r5_grounded_embodiment.py
```
