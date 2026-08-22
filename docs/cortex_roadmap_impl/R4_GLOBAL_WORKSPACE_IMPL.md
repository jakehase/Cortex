# R4 Global Workspace v1 — Phase A Implementation Slice

## Scope delivered
- `services/workspace/arbitration_engine.py` — specialist competition + scoring trace.
- `services/workspace/broadcast_policy.py` — selective workspace broadcast policy.
- `services/workspace/bus_protocol.json` — message contract for workspace bus.
- `config/cortex_runtime/r4_global_workspace_v1.json` — arbitration/broadcast runtime config.

## Core behavior
1. Score specialist proposals by utility, confidence, latency quality, and cost quality.
2. Produce full scoring trace for observability.
3. Select winner deterministically from ranked proposals.
4. Broadcast high-priority workspace signals to routed specialist targets.

## Run
```bash
python3 services/workspace/arbitration_engine.py
python3 scripts/probes/probe_r4_workspace.py
```

## Current limits
- Arbitration uses static weights only (no policy learning).
- Broadcast policy is rule-based (no dynamic congestion feedback yet).
