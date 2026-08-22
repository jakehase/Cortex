# VM102 Native Fabrics Status — 2026-03-15

## Summary
Implemented native Cortex-side replacements inspired by MiroFish and OpenViking on VM102 (`10.0.0.52` / `cortex-vm`).

## Live components on VM102
- `context_fabric` — live and materially improving retrieval quality
- `prediction_fabric` — live with production split:
  - `mode=fast` → synchronous
  - `mode=balanced` → synchronous
  - `mode=deep` → asynchronous job workflow
- `backend_integrations/status` — live backend status router
- Experimental repos staged under `/opt/clawdbot/experimental/`:
  - `MiroFish/`
  - `OpenViking/`

## Context side (OpenViking-inspired)
### Implemented
- tiered retrieval
- durable-first mode
- awareness-noise filtering
- traceable retrieval results
- curated durable/project/anti-drift/noise-suppression seeds loaded into VM102 memory

### Current quality
Important queries now return curated/durable results first for:
- `What should be prioritized?`
- `stop drifting`
- `side quests`
- `Cortex OpenClaw integration`

### Status
- practical status: **good / usable**
- production readiness: **good**

## Prediction side (MiroFish-inspired)
### Implemented
- native `prediction_fabric` orchestration with direct in-process composition
- sync/async split:
  - `fast` sync lane
  - `balanced` sync lane
  - `deep` async job lane
- native deep job tracking endpoints:
  - `POST /prediction_fabric/forecast`
  - `GET /prediction_fabric/jobs/{job_id}`
- in-process forecast backend shared by Seer/Simulator/Council
- simulator deep mode rewritten as an outcome-matrix workflow (best / most-likely / worst generated separately)

### Verified behavior
- `prediction_fabric mode=fast`
  - returns `200`
  - ~13s
  - `success=true`
- `prediction_fabric mode=balanced`
  - returns `200`
  - ~24s
  - `success=true`
  - includes working simulator leg
- `prediction_fabric mode=deep`
  - returns accepted job immediately
  - latest deep job completed successfully in ~85s
  - latest deep success notes:
    - `seer_ok`
    - `simulator_ok`
    - `council_ok`

### Status
- practical status: **good / usable**
- production readiness: **good for intended sync/async split**

## Remaining caveats
- direct `simulator/run` with `mode=deep` is still a synchronous endpoint and is not the intended production path for deep usage; production deep usage should go through `prediction_fabric mode=deep`.
- OpenViking and MiroFish upstream services remain staged/scaffolded, but the native Cortex fabrics are now the primary working implementation path.

## Recommendation
Use this as the production shape:
1. `fast` sync for interactive lightweight forecasting
2. `balanced` sync for richer interactive forecasting
3. `deep` async jobs for highest-fidelity prediction runs
