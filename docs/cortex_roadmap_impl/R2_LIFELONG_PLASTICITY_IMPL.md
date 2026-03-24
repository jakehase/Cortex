# R2 Lifelong Plasticity v1 — Phase B Implementation Slice

## Scope delivered
- `services/plasticity/replay_scheduler.py` — deterministic anchor-aware replay scheduling.
- `services/plasticity/anchor_protection_policy.json` — anchor/retention/rollback contract.
- `services/plasticity/continual_eval.py` — continual-learning retain/transfer/forget evaluator.
- `services/plasticity/forgetting_alerts.py` — explicit forgetting severity + rollback recommendation.
- `config/cortex_runtime/r2_lifelong_plasticity_v1.json` — runtime wiring for scheduler/eval/alerts.

## Core behavior
1. Score replay candidates by anchor strength + forgetting risk + novelty + utility.
2. Enforce minimum anchor quota per replay batch.
3. Measure retention regression, forward transfer gain, and anchor violations after updates.
4. Trigger warning/critical forgetting alerts and rollback recommendation under policy thresholds.

## Run
```bash
python3 services/plasticity/replay_scheduler.py
python3 services/plasticity/continual_eval.py --policy services/plasticity/anchor_protection_policy.json
python3 scripts/probes/probe_r2_plasticity.py
```

## Current limits
- Replay policy is static (no learned scheduler yet).
- Evaluation assumes scalar anchor scores, not full task distributions.
- Rollback path emits recommendation only (no automatic orchestration hook yet).
