# R7 Value/Homeostasis v2 — Phase B Implementation Slice

## Status in this checkout

**This implementation doc was ahead of the repo.**

Current live state:
- **Actually landed now:**
  - `services/homeostasis/baseline_regulation.py`
  - `services/homeostasis/state_signal_model.py`
  - `services/homeostasis/value_hierarchy_compiler.py`
  - `services/homeostasis/conflict_arbitration_v2.py`
  - `services/homeostasis/dynamic_budget_allocator.py`
  - `services/homeostasis/adaptive_effort_controller.py`
  - `services/homeostasis/safety_envelope_overrides.py`
  - `services/homeostasis/shadow_governor_runner.py`
  - `services/homeostasis/canary_governor_controller.py`
  - `services/homeostasis/full_rollout_autotuner.py`
  - `services/homeostasis/objective_hierarchy.json`
  - `scripts/cortex_r7_step1_baseline_regulation.py`
  - `scripts/cortex_r7_step2_state_signal_model.py`
  - `scripts/cortex_r7_step3_value_hierarchy_compiler.py`
  - `scripts/cortex_r7_step4_conflict_arbitration.py`
  - `scripts/cortex_r7_step5_dynamic_budget_allocator.py`
  - `scripts/cortex_r7_step6_adaptive_effort_controller.py`
  - `scripts/cortex_r7_step7_safety_envelope_overrides.py`
  - `scripts/cortex_r7_step8_shadow_governor_runner.py`
  - `scripts/cortex_r7_step9_canary_governor_controller.py`
  - `scripts/cortex_r7_step10_full_rollout_autotuner.py`
  - `config/cortex_roadmap/r7_step1_baseline_regulation_contract.json`
  - `config/cortex_roadmap/r7_step2_state_signal_model_contract.json`
  - `config/cortex_roadmap/r7_step3_value_hierarchy_compiler_contract.json`
  - `config/cortex_roadmap/r7_step4_conflict_arbitration_contract.json`
  - `config/cortex_roadmap/r7_step5_dynamic_budget_allocator_contract.json`
  - `config/cortex_roadmap/r7_step6_adaptive_effort_controller_contract.json`
  - `config/cortex_roadmap/r7_step7_safety_envelope_overrides_contract.json`
  - `config/cortex_roadmap/r7_step8_shadow_governor_runner_contract.json`
  - `config/cortex_roadmap/r7_step9_canary_governor_controller_contract.json`
  - `config/cortex_roadmap/r7_step10_full_rollout_autotuner_contract.json`
  - `artifacts/cortex_roadmap/r7_value_homeostasis/step1/baseline_regulation_snapshot_latest.json`
  - `artifacts/cortex_roadmap/r7_value_homeostasis/step1/baseline_regulation_probe_latest.json`
  - `artifacts/cortex_roadmap/r7_value_homeostasis/step2/state_signal_snapshot_latest.json`
  - `artifacts/cortex_roadmap/r7_value_homeostasis/step2/state_signal_probe_latest.json`
  - `artifacts/cortex_roadmap/r7_value_homeostasis/step3/value_hierarchy_compiled_latest.json`
  - `artifacts/cortex_roadmap/r7_value_homeostasis/step3/value_hierarchy_probe_latest.json`
  - `artifacts/cortex_roadmap/r7_value_homeostasis/step4/arbitration_probe_latest.json`
  - `artifacts/cortex_roadmap/r7_value_homeostasis/step5/budget_allocator_probe_latest.json`
  - `artifacts/cortex_roadmap/r7_value_homeostasis/step6/adaptive_effort_probe_latest.json`
  - `artifacts/cortex_roadmap/r7_value_homeostasis/step7/safety_override_probe_latest.json`
  - `artifacts/cortex_roadmap/r7_value_homeostasis/step8/shadow_governor_probe_latest.json`
  - `artifacts/cortex_roadmap/r7_value_homeostasis/step9/canary_governor_probe_latest.json`
  - `artifacts/cortex_roadmap/r7_value_homeostasis/step10/full_rollout_autotune_latest.json`
  - `artifacts/cortex_roadmap/r7_value_homeostasis/step10/full_rollout_autotune_probe_latest.json`
  - `artifacts/cortex_roadmap/r7_value_homeostasis/step11/dashboard_probe_latest.json`
  - `artifacts/cortex_roadmap/r7_value_homeostasis/step12/novelty_probe_latest.json`

## Intended scope
The broader intended scope remains:
- `services/homeostasis/objective_hierarchy.json` — explicit value hierarchy contract.
- `services/homeostasis/resource_budget_manager.py` — soft/hard resource budget evaluation and allocation.
- `services/homeostasis/conflict_resolver.py` — baseline conflict arbitration aligned with hierarchy.
- `services/homeostasis/conflict_arbitration_v2.py` — Step 4 explainable arbitration engine with deterministic replay checks.
- `services/homeostasis/dynamic_budget_allocator.py` — Step 5 dynamic per-turn budget allocation with incident/recovery reserve pools.
- `services/homeostasis/adaptive_effort_controller.py` — Step 6 mode/depth controller coupled to route guardrails.
- `services/homeostasis/safety_envelope_overrides.py` — Step 7 hard-override guard with emergency freeze and baseline-safe fallback.
- `services/homeostasis/shadow_governor_runner.py` — Step 8 recommend-only shadow evaluation for uplift/disagreement/safety trends.
- `services/homeostasis/canary_governor_controller.py` — Step 9 staged canary simulator with kill-switch remediation hooks.
- `services/homeostasis/full_rollout_autotuner.py` — Step 10 bounded objective-weight tuner + intent kill-switch updater.
- `services/homeostasis/operator_dashboard.py` — Step 11 dashboard panel builder + freeze/rollback/resume runbook controls.
- `services/homeostasis/novelty_packager.py` — Step 12 claim-map + reproducibility manifest + internal novelty review helpers.
- `services/homeostasis/adaptive_regulator.py` — stress-aware mode switching (`normal|conserve|protective`).
- `config/cortex_runtime/r7_value_homeostasis_v1.json` — runtime wiring for hierarchy/budget/resolve/regulate.

## Core behavior
1. Enforce objective rank ordering (`safety > truth > user_intent > reliability > efficiency`).
2. Monitor soft/hard budget breaches for tokens, latency, and cognitive load.
3. Allocate dynamic budgets by intent/risk/load with incident/recovery reserve pools.
4. Resolve goal conflicts with explicit trace, deterministic tie breaks, and policy explainability reasons.
5. Couple state + budget + route guardrails into adaptive effort decisions (mode/depth/token cap).
6. Enforce hard overrides (unsafe tradeoff / timeout spike / oscillation) with baseline-safe fallback and emergency freeze.
7. Run shadow governor in recommend-only mode and track uplift/disagreement/safety over a rolling window.
8. Stage canary rollout progression (10% -> 30%) with per-intent kill-switch remediation logic.
9. Promote full rollout for eligible intents with bounded 24h self-tuning over a 14-day post-rollout window.
10. Surface operator panels (utility/depth/latency/cost/risk/alert-noise/arbitration traces) with one-click controls.
11. Execute freeze -> rollback -> resume runbook drills and verify end-to-end control integrity.
12. Produce novelty claim maps + reproducibility manifests + internal review verdicts with evidence traceability.
13. Shift effort mode under stress or hard pressure to preserve safety and stability.

## Run
```bash
python3 services/homeostasis/resource_budget_manager.py
python3 services/homeostasis/conflict_resolver.py
python3 services/homeostasis/dynamic_budget_allocator.py
python3 services/homeostasis/adaptive_effort_controller.py
python3 services/homeostasis/safety_envelope_overrides.py
python3 services/homeostasis/shadow_governor_runner.py
python3 services/homeostasis/canary_governor_controller.py
python3 services/homeostasis/adaptive_regulator.py
python3 scripts/probes/probe_r7_homeostasis.py
python3 scripts/cortex_r7_step5_dynamic_budget_allocator.py
python3 scripts/cortex_r7_step6_adaptive_effort_controller.py
python3 scripts/cortex_r7_step7_safety_envelope.py
python3 scripts/cortex_r7_step8_shadow_governor.py
python3 scripts/cortex_r7_step9_canary_rollout.py
python3 scripts/cortex_r7_step10_full_rollout_autotune.py
python3 scripts/cortex_r7_step11_operator_dashboard.py
python3 scripts/cortex_r7_step12_novelty_packaging.py
python3 scripts/serve_r7_dashboard_local.py --host 0.0.0.0 --port 18712
```

## Current limits
- Resolver uses static hierarchy and fixed score function.
- No long-horizon adaptation memory for value weight tuning yet.
- Regulator is policy-only (not yet coupled to live orchestrator hooks).
lue weight tuning yet.
- Regulator is policy-only (not yet coupled to live orchestrator hooks).
