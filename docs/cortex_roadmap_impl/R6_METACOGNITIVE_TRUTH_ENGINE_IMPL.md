# R6 Metacognitive Truth Engine v1 — Phase A Implementation Slice

## Scope delivered
- `services/truth_engine/claim_graph.py` — claim/evidence graph with support+contradiction scoring.
- `services/truth_engine/calibration_model.py` — confidence calibration + uncertainty banding.
- `services/truth_engine/confabulation_detector.py` — unsupported/contradiction risk classifier.
- `services/truth_engine/pre_send_guard.py` — runnable pre-send guard stub (`allow|clarify|block`).
- `config/cortex_runtime/r6_truth_engine_v1.json` — runtime contract/config for thresholds.

## Core behavior
1. Build claim/evidence graph from response payload.
2. Calibrate raw confidence with piecewise bins.
3. Detect confabulation risk per claim (unsupported, contradicted, uncertainty).
4. Emit guard action:
   - `block` on high-risk claims,
   - `clarify` on medium-risk uncertainty,
   - `allow` otherwise.

## Run
```bash
python3 services/truth_engine/pre_send_guard.py
python3 scripts/probes/probe_r6_truth_engine.py
```

## Current limits
- No external retrieval integration yet (input payload must provide evidence links).
- Calibration bins are static and not yet learned online.
