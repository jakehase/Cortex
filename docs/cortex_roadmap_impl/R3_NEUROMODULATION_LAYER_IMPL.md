# R3 Neuromodulation Layer v0 — Phase A Implementation Slice

## Scope delivered
- `services/modulation/signal_schema.json` — modulation signal contract.
- `services/modulation/safety_bounds.json` — safety limits for depth/learning/token budget.
- `services/modulation/policy_runtime.py` — modulation runtime policy.
- `services/modulation/adaptive_depth_controller.py` — adaptive depth policy function.
- `config/cortex_runtime/r3_neuromod_layer_v0.json` — neuromod runtime config.

## Core behavior
1. Normalize/clamp modulation signals.
2. Compute adaptive depth from salience+uncertainty+urgency.
3. Compute learning rate adaptation from novelty+uncertainty.
4. Enforce safety bounds and generate token budget guidance.

## Run
```bash
python3 services/modulation/adaptive_depth_controller.py
python3 scripts/probes/probe_r3_neuromod.py
```

## Current limits
- No personalized modulation profile yet.
- Policy is feed-forward and does not include stability memory.
