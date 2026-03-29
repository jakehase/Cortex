# Phase D Wave — Post-Phase-C Integration + Hardening + Benchmark

## Status in this checkout

**This document is roadmap intent, not a verified shipped slice in the current repo checkout.**

Audit date: `2026-03-29`
Reference: `docs/PHASE_D_REPO_AUDIT_2026-03-29.md`

### Reality check
- This repo checkout does **not** currently contain the embodiment implementation tree or Phase D Wave scripts/artifacts listed below.
- The items in this document should be treated as **planned / previously intended deliverables** unless and until the missing code is restored.

## Artifact status matrix

### Claimed implementation files
- `services/embodiment/episode_orchestrator.py` — **missing**
- `services/embodiment/scenario_profiles.py` — **missing**

### Claimed entry points
- `scripts/cortex_r5_embodiment_orchestrator.py` — **missing**
- `scripts/probes/probe_phase_d_integration.py` — **missing**
- `scripts/probes/probe_phase_d_hardening.py` — **missing**
- `scripts/run_phase_d_embodiment_benchmark.py` — **missing**
- `scripts/cortex_phase_d_impl_wave.py` — **missing**

### Claimed artifacts
- `artifacts/cortex_roadmap/phase_d_wave/integration/*` — **missing**
- `artifacts/cortex_roadmap/phase_d_wave/hardening/*` — **missing**
- `artifacts/cortex_roadmap/phase_d_wave/benchmark/*` — **missing**
- `artifacts/cortex_roadmap/phase_d_wave/phase_d_impl_run_latest.json` — **missing**

### Claimed hook names referenced in docs only
The following symbols were not found in implementation code during audit:
- `WorldStateModel.merge_embodiment_episode`
- `ArbitrationEngine.arbitrate_embodiment_episode`
- `BroadcastPolicy.select_from_embodiment_episode`
- `AdaptiveRegulator.regulate_with_embodiment_hooks`
- `contract_baseline_v2`
- `sim2real_transfer_v1`
- `failure_taxonomy_challenge_v1`

## Intended scope
If restored, the intended Phase D Wave scope is:
- orchestrator-level episode wiring from R5 outputs into R1 / R4 / R7 surfaces
- hardening upgrades in the simulator/runner
- deterministic scenario profiles
- benchmark pack with reproducibility and failure taxonomy

## Restore checklist
To make this doc honestly say "delivered" again, restore or implement:
1. `services/embodiment/episode_orchestrator.py`
2. `services/embodiment/scenario_profiles.py`
3. the five missing scripts listed above
4. `artifacts/cortex_roadmap/phase_d_wave/*` or an artifact manifest proving reproducible generation
5. tests or probes exercising the claimed hooks
