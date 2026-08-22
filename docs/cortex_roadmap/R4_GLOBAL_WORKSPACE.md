# R4 — Global workspace + local specialists

## Objective
Create a dynamic workspace where specialist modules compete/cooperate with explicit broadcast and arbitration semantics.

## Phase
Phase A (0-8 weeks foundation)

## Build-now track (0-8 weeks)
### Milestones
- Define workspace bus protocol and shared context contract.
- Implement specialist arbitration engine with tie-break policy.
- Add selective broadcast policy for conscious-access style context sharing.
- Ship workspace observability dashboard with per-turn arbitration traces.

### Deliverables
- `services/workspace/bus_protocol.json`
- `services/workspace/arbitration_engine.py`
- `services/workspace/broadcast_policy.py`
- `services/workspace/observability_dashboard.md`

### Metrics
- `wrong_specialist_activation_rate` target: **<=10%**
- `arbitration_resolution_latency_ms` target: **<=250**
- `cross_module_conflict_incidents_per_100` target: **<=2**

## Research track (8-24+ weeks)
### Open questions
- How to approximate conscious-access behavior without brittle global synchronization?
- What arbitration strategies improve compositional reasoning quality?

### Research milestones
- Define hypothesis suite and evaluation protocol.
- Run controlled experiments and collect failure modes.
- Publish reproducibility package and external benchmark comparisons.

## Dependencies
- Requires: None
- Unlocks: R1, R6, R5

## Execution
```bash
python3 /root/.openclaw/workspace/scripts/cortex_r4_global_workspace.py
```
