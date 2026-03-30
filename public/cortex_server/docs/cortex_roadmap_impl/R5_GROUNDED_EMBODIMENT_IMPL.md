# R5 Grounded Embodiment v1 — Phase C Implementation Slice

## Scope delivered
- `services/embodiment/sensorimotor_api.json` — canonical observation/action contract + safety bounds.
- `services/embodiment/sim_safety_sandbox.py` — deterministic sim-first environment with intervention and recovery latching.
- `services/embodiment/closed_loop_runner.py` — closed-loop policy runner with bounded actions, hazard handling, and execution traces.
- `services/embodiment/robotics_adapter.md` — sim-to-real adapter contract and transport plan.
- `config/cortex_runtime/r5_grounded_embodiment_v1.json` — runtime wiring and gate contract.
- `scripts/probes/probe_r5_embodiment.py` — explicit probe gate suite for R5.
- `scripts/cortex_phase_c_impl_wave.py` — aggregate Phase C compile/probe/gate runner.

## Core behavior
1. Validate sensorimotor contract shape and safety thresholds.
2. Execute nominal closed-loop task (`reach_goal`) in simulator.
3. Inject hazard, trigger safety intervention, and execute recovery path.
4. Stress policy gain to force raw out-of-range actions, then enforce bounded actuator outputs.
5. Emit timestamped + latest artifacts for probe and phase-wave aggregate checks.

## Run
```bash
python3 -m py_compile \
  services/embodiment/sim_safety_sandbox.py \
  services/embodiment/closed_loop_runner.py \
  scripts/probes/probe_r5_embodiment.py \
  scripts/cortex_phase_c_impl_wave.py

python3 scripts/probes/probe_r5_embodiment.py
python3 scripts/cortex_phase_c_impl_wave.py
```

## Probe gates
- `r5_sensorimotor_contract_valid`
- `r5_closed_loop_completes_nominal_task`
- `r5_safety_intervention_triggers_on_hazard`
- `r5_recovery_path_executes_after_intervention`
- `r5_policy_output_within_action_bounds`

## Current limits
- Environment is still 2D sim-first.
- Recovery policy remains rule-based (not yet learned/adaptive end-to-end).
- Robotics adapter is documented but not wired to live hardware transport in this slice.

## Phase D extension status

**Landed and repo-verified in this checkout.**

Reference: `docs/PHASE_D_REPO_AUDIT_2026-03-29.md`

### Current Phase D extension now present
- orchestrator wiring from embodiment episode outputs into world-state / arbitration / signaling / regulation compatibility hooks
- hardening: stochastic sweeps, fault-injection scenarios, watchdog timeout controls, and regression-oriented safety behavior
- benchmark pack outputs under `artifacts/cortex_roadmap/phase_d_wave/benchmark/`

### Present files
- `services/embodiment/episode_orchestrator.py`
- `services/embodiment/scenario_profiles.py`
- `scripts/probes/probe_phase_d_integration.py`
- `scripts/probes/probe_phase_d_hardening.py`
- `scripts/run_phase_d_embodiment_benchmark.py`
- `scripts/cortex_phase_d_impl_wave.py`

### Remaining limits
- this landed extension still uses local compatibility hook implementations rather than full external R1/R4/R7 subsystem backends
- benchmark scale and confidence interval logic are still lightweight
- live hardware transport remains out of scope
