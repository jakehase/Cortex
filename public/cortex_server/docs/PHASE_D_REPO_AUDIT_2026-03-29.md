# Phase D Repo Audit — 2026-03-29

## Verdict

Phase D is **landed in a real, runnable, validated form** in this checkout.

That does **not** mean every long-horizon roadmap extension is complete. It means the repo now contains working, tested slices for the major Phase D areas that were previously only partially implemented or only documented.

Three different things are currently being called “Phase D”:

1. **Runtime analytics / reasoning runtime Phase D work in `public/cortex_server`**
   - Status: **implemented and verified green**
   - Evidence: `PYTHONPATH=/root/clawd/public/cortex_server pytest -q /root/clawd/public/cortex_server/tests`
   - Result at audit time: **243 passed**

2. **Broader roadmap / embodiment “Phase D Wave”**
   - Status: **landed as a validated MVP slice**
   - Evidence:
     - `services/embodiment/episode_orchestrator.py`
     - `services/embodiment/scenario_profiles.py`
     - `scripts/cortex_r5_embodiment_orchestrator.py`
     - `scripts/probes/probe_phase_d_integration.py`
     - `scripts/probes/probe_phase_d_hardening.py`
     - `scripts/run_phase_d_embodiment_benchmark.py`
     - `scripts/cortex_phase_d_impl_wave.py`
     - `artifacts/cortex_roadmap/phase_d_wave/phase_d_impl_run_latest.json`
     - `tests/test_phase_d_embodiment.py`
   - Interpretation: the repo now has a real simulator/orchestration/hardening/benchmark slice that runs and is tested, even though it is still lighter than the broadest possible embodiment vision.

3. **R9 adaptive routing “Phase D2”**
   - Status: **landed as a stable bootstrap slice**
   - Evidence:
     - `services/routing/route_feature_pipeline.py`
     - `services/routing/adaptive_router_policy.py`
     - `services/routing/chain_candidate_generator.py`
     - `services/routing/replay_significance.py`
     - `services/routing/safety_rollback_guard.py`
     - `services/routing/shadow_mode_runner.py`
     - `services/routing/canary_rollout_controller.py`
     - `services/routing/full_rollout_autotuner.py`
     - `scripts/cortex_r9_step1_baseline_telemetry.py`
     - `scripts/cortex_r9_step10_full_rollout_autotune.py`
     - `scripts/cortex_r9_adaptive_routing_brain.py`
     - `tests/test_phase_d_routing_bootstrap.py`
   - Interpretation: there is now a real routing bootstrap path, backed by runnable artifacts and tests. It is still not the full 12-step roadmap stack, but it is no longer just a paper plan.

## Docs audited

- `docs/cortex_roadmap_impl/PHASE_D_WAVE_EMBODIMENT_INTEGRATION.md`
- `docs/cortex_roadmap_impl/R5_GROUNDED_EMBODIMENT_IMPL.md`
- `docs/cortex_roadmap/R9_ADAPTIVE_ROUTING_BRAIN.md`

## What is verified present

### Verified runtime / reasoning work

Present under `public/cortex_server`:
- reasoning runtime modules
- orchestrator runtime surfaces
- analytics summary / report / compare / correlation routes
- reasoning test suite
- world grounding module and tests

Live test result during audit:
- `243 passed`

### Adjacent but not equivalent infrastructure

Present:
- `public/cortex_server/cortex_server/modules/world_grounding.py`
- `public/cortex_server/tests/test_nexus_world_grounding.py`
- `plugins/cortex-route-gate/*`
- `docs/CORTEX_CODEC.md`

These are real and useful, but they are **not the same thing** as the specific Phase D Wave embodiment deliverables claimed in the roadmap docs.

## Embodiment Phase D Wave current state

The following doc exists:
- `docs/cortex_roadmap_impl/PHASE_D_WAVE_EMBODIMENT_INTEGRATION.md`

### Present embodiment files
- `services/embodiment/episode_orchestrator.py`
- `services/embodiment/scenario_profiles.py`
- `services/embodiment/integration_hooks.py`
- `services/embodiment/sim_safety_sandbox.py`
- `services/embodiment/closed_loop_runner.py`

### Present scripts / entry points
- `scripts/cortex_r5_embodiment_orchestrator.py`
- `scripts/probes/probe_phase_d_integration.py`
- `scripts/probes/probe_phase_d_hardening.py`
- `scripts/run_phase_d_embodiment_benchmark.py`
- `scripts/cortex_phase_d_impl_wave.py`

### Present artifacts
- `artifacts/cortex_roadmap/phase_d_wave/README.md`
- `artifacts/cortex_roadmap/phase_d_wave/integration/*`
- `artifacts/cortex_roadmap/phase_d_wave/hardening/*`
- `artifacts/cortex_roadmap/phase_d_wave/benchmark/*`
- `artifacts/cortex_roadmap/phase_d_wave/phase_d_impl_run_latest.json`

### Present hook/profile symbols
- `WorldStateModel.merge_embodiment_episode`
- `ArbitrationEngine.arbitrate_embodiment_episode`
- `BroadcastPolicy.select_from_embodiment_episode`
- `AdaptiveRegulator.regulate_with_embodiment_hooks`
- `contract_baseline_v2`
- `sim2real_transfer_v1`
- `failure_taxonomy_challenge_v1`

### Remaining embodiment gaps
- hook implementations are local compatibility surfaces, not full external R1/R4/R7 subsystem integrations
- benchmarking is reproducible but still lightweight
- test coverage now exists, but it is still compact rather than exhaustive

## R9 Phase D2 current state

The following doc exists:
- `docs/cortex_roadmap/R9_ADAPTIVE_ROUTING_BRAIN.md`

### Present routing bootstrap files
- `services/routing/route_feature_pipeline.py`
- `services/routing/adaptive_router_policy.py`
- `services/routing/chain_candidate_generator.py`
- `services/routing/counterfactual_replay_evaluator.py`
- `services/routing/replay_significance.py`
- `services/routing/safety_rollback_guard.py`
- `services/routing/shadow_mode_runner.py`
- `services/routing/canary_rollout_controller.py`
- `services/routing/full_rollout_autotuner.py`

### Present routing scripts / artifacts
- `scripts/cortex_r9_step1_baseline_telemetry.py`
- `scripts/cortex_r9_step8_shadow_mode.py`
- `scripts/cortex_r9_step9_canary_rollout.py`
- `scripts/cortex_r9_step10_full_rollout_autotune.py`
- `scripts/cortex_r9_adaptive_routing_brain.py`
- `artifacts/cortex_roadmap/r9_adaptive_routing_brain/README.md`
- `artifacts/cortex_roadmap/r9_adaptive_routing_brain/step1/*`
- `artifacts/cortex_roadmap/r9_adaptive_routing_brain/step8/*`
- `artifacts/cortex_roadmap/r9_adaptive_routing_brain/step9/*`
- `artifacts/cortex_roadmap/r9_adaptive_routing_brain/step10/*`

### Remaining R9 gaps
- the bootstrap is still a thin support layer, not the full 12-step roadmap
- many step-specific scripts/configs/dashboard/novelty surfaces are still absent
- this should continue to reuse Nexus/modules rather than diverge into a second routing stack

## Best current answer

If someone asks **“Is Phase D done?”**, the accurate answer is now:

- **Reasoning runtime / analytics Phase D work:** yes, done and tested.
- **Embodiment / roadmap Phase D Wave:** yes, landed as a runnable validated slice.
- **R9 adaptive routing Phase D2:** yes, landed as a stable bootstrap slice.
- **Broader future expansion beyond those landed slices:** still open work, not a reason to say the current Phase D never landed.

## Remaining expansion work

1. Replace local compatibility hooks with real subsystem integrations where available.
2. Expand routing coverage beyond step1/8/9/10 into the remaining roadmap surfaces.
3. Keep routing wrappers aligned to existing Nexus/module truth rather than forked logic.
4. Add larger replay datasets and stronger evaluation evidence before making full-rollout-strength claims.
5. Deepen test coverage from compact validation into broader regression coverage.

## Recommended next move

Treat Phase D as **landed**, then work the remaining items as **post-landing hardening and expansion**, not as blockers to calling the phase real.
