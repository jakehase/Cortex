# R7 — Value/Homeostasis Governor (Powerhouse Track)

## Objective
Turn Cortex regulation into an adaptive governor that continuously balances:
- response quality/depth,
- latency/reliability,
- compute burn/cost,
- alert noise,
- safety constraints,
under explicit value hierarchy and hard guardrails.

## Why now
R9 routing, staged rollout, and operator controls are now in place and green. The next leverage move is to make regulation itself adaptive so Cortex can self-balance speed, depth, and reliability by context without operator micromanagement.

## Phase
Phase B2 (immediate execution track, 2–8 weeks)

## Step-by-step execution plan

### Step 1 — Baseline regulation telemetry lock
- Freeze current behavior across alerting, response depth, latency, reliability, and compute burn.
- Capture at least 14-day baseline windows by intent/risk tier.
- **Gate:** reproducible baseline dataset + drift-stable probes.
- Execution artifacts:
  - `scripts/cortex_r7_step1_baseline_regulation.py`
  - `config/cortex_roadmap/r7_step1_baseline_regulation_contract.json`
  - `artifacts/cortex_roadmap/r7_value_homeostasis/step1/baseline_regulation_probe_latest.json`

### Step 2 — Homeostatic state vector + signal model
- Define canonical state vector (urgency, risk pressure, fatigue, timeout pressure, error pressure, budget pressure, escalation debt).
- Add health signal smoothing + anomaly tags.
- **Gate:** signal completeness and stability checks pass.
- Execution artifacts:
  - `services/homeostasis/state_signal_model.py`
  - `scripts/cortex_r7_step2_state_signal_model.py`
  - `config/cortex_roadmap/r7_step2_state_signal_model_contract.json`
  - `artifacts/cortex_roadmap/r7_value_homeostasis/step2/state_signal_probe_latest.json`

### Step 3 — Value hierarchy compiler
- Formalize utility ordering: safety > truth > user intent > reliability > efficiency.
- Convert hierarchy into enforceable policy constraints and tie-breakers.
- **Gate:** no hierarchy violations in replay harness.
- Execution artifacts:
  - `services/homeostasis/value_hierarchy_compiler.py`
  - `scripts/cortex_r7_step3_value_hierarchy_compiler.py`
  - `config/cortex_roadmap/r7_step3_value_hierarchy_compiler_contract.json`
  - `artifacts/cortex_roadmap/r7_value_homeostasis/step3/value_hierarchy_probe_latest.json`

### Step 4 — Conflict arbitration engine v2
- Resolve competing objectives with explainable traces (why this tradeoff was chosen).
- Emit arbitration reasons for dashboard and audit consumption.
- **Gate:** conflict resolution success >= 0.92 in benchmark scenarios.
- Execution artifacts:
  - `services/homeostasis/conflict_arbitration_v2.py`
  - `scripts/cortex_r7_step4_conflict_arbitration.py`
  - `config/cortex_roadmap/r7_step4_conflict_arbitration_contract.json`
  - `artifacts/cortex_roadmap/r7_value_homeostasis/step4/arbitration_probe_latest.json`

### Step 5 — Dynamic budget allocator
- Allocate token/depth/latency budgets dynamically by intent/risk/load.
- Implement budget reserve pools for incident and recovery modes.
- **Gate:** budget overrun events <= 2 per 100 simulated turns.
- Execution artifacts:
  - `services/homeostasis/dynamic_budget_allocator.py`
  - `scripts/cortex_r7_step5_dynamic_budget_allocator.py`
  - `config/cortex_roadmap/r7_step5_dynamic_budget_allocator_contract.json`
  - `artifacts/cortex_roadmap/r7_value_homeostasis/step5/budget_allocator_probe_latest.json`

### Step 6 — Adaptive effort controller
- Build controller mapping state -> mode (`normal`, `conserve`, `protective`) + depth policy.
- Couple mode decisions to R9 route recommendations and guardrails.
- **Gate:** quality non-regression + bounded latency/cost on replay.
- Execution artifacts:
  - `services/homeostasis/adaptive_effort_controller.py`
  - `scripts/cortex_r7_step6_adaptive_effort_controller.py`
  - `config/cortex_roadmap/r7_step6_adaptive_effort_controller_contract.json`
  - `artifacts/cortex_roadmap/r7_value_homeostasis/step6/adaptive_effort_probe_latest.json`

### Step 7 — Safety envelope + hard overrides
- Add hard overrides for risky tradeoffs and oscillation prevention.
- Add emergency freeze and forced baseline fallback path.
- **Gate:** unsafe-tradeoff incidents <= 1 per 100 and rollback recovery <= 60s.
- Execution artifacts:
  - `services/homeostasis/safety_envelope_overrides.py`
  - `scripts/cortex_r7_step7_safety_envelope.py`
  - `config/cortex_roadmap/r7_step7_safety_envelope_contract.json`
  - `artifacts/cortex_roadmap/r7_value_homeostasis/step7/override_probe_latest.json`

### Step 8 — Shadow governor deployment
- Run governor in recommend-only mode against live traffic.
- Measure disagreement with current policy and expected utility/noise impact.
- **Gate:** stable uplift signal + no safety/regression events over 7-day shadow window.
- Execution artifacts:
  - `services/homeostasis/shadow_governor_runner.py`
  - `scripts/cortex_r7_step8_shadow_governor.py`
  - `config/cortex_roadmap/r7_step8_shadow_governor_contract.json`
  - `artifacts/cortex_roadmap/r7_value_homeostasis/step8/shadow_probe_latest.json`

### Step 9 — Canary rollout (10% -> 30%)
- Enable governor for selected eligible intents first.
- Keep per-intent kill switches and real-time rollback hooks.
- **Gate:** quality non-regression, latency/cost bounds, zero critical policy violations.
- Execution artifacts:
  - `services/homeostasis/canary_governor_controller.py`
  - `scripts/cortex_r7_step9_canary_rollout.py`
  - `config/cortex_roadmap/r7_step9_canary_rollout_contract.json`
  - `artifacts/cortex_roadmap/r7_value_homeostasis/step9/canary_probe_latest.json`
- Latest run: `r7-step9-12842520` (`step9_canary_rollout_gate_pass=true`).

### Step 10 — Full rollout + bounded self-tuning
- Promote to default for eligible intents.
- Enable bounded periodic weight tuning with explicit max-step limits.
- **Gate:** 14-day post-rollout SLO compliance.
- Execution artifacts:
  - `services/homeostasis/full_rollout_autotuner.py`
  - `scripts/cortex_r7_step10_full_rollout_autotune.py`
  - `config/cortex_roadmap/r7_step10_full_rollout_autotune_contract.json`
  - `artifacts/cortex_roadmap/r7_value_homeostasis/step10/full_rollout_probe_latest.json`
- Latest run: `r7-step10-dd1499e8` (`step10_full_rollout_autotune_gate_pass=true`).

### Step 11 — Operator dashboard + runbook drills
- Dashboard panels: utility, depth, latency, cost, risk, alert noise, arbitration traces.
- One-click controls: freeze, rollback, resume.
- **Gate:** runbook drill completes successfully end-to-end.
- Execution artifacts:
  - `services/homeostasis/operator_dashboard.py`
  - `scripts/cortex_r7_step11_operator_dashboard.py`
  - `config/cortex_roadmap/r7_step11_operator_dashboard_contract.json`
  - `artifacts/cortex_roadmap/r7_value_homeostasis/step11/dashboard_probe_latest.json`
- Latest run: `r7-step11-b7517787` (`step11_operator_dashboard_gate_pass=true`).

### Step 12 — Novelty packaging + claim map
- Build claim-oriented technical brief + reproducibility pack.
- Include evidence map for adaptive regulation + safety-governed deployment.
- **Gate:** internal novelty review complete with claim traceability.
- Execution artifacts:
  - `services/homeostasis/novelty_packager.py`
  - `scripts/cortex_r7_step12_novelty_packaging.py`
  - `config/cortex_roadmap/r7_step12_novelty_packaging_contract.json`
  - `artifacts/cortex_roadmap/r7_value_homeostasis/step12/novelty_probe_latest.json`
- Latest run: `r7-step12-bd12f246` (`step12_novelty_packaging_gate_pass=true`).

## Go / No-Go metrics
- `unsafe_tradeoff_incidents_per_100`: **<= 1**
- `budget_overrun_events_per_100`: **<= 2**
- `goal_conflict_resolution_success`: **>= 0.92**
- `quality_non_regression_rate`: **>= 0.99**
- `p95_latency_delta`: **<= +0.05**
- `cost_per_turn_delta`: **<= baseline**
- `alert_noise_index_delta`: **<= -0.30**
- `rollback_trigger_recovery_time_s`: **<= 60**

## Execution artifacts (planned)
- `config/cortex_roadmap/r7_value_homeostasis_contract.json`
- `scripts/cortex_r7_value_homeostasis.py`
- `services/homeostasis/resource_budget_manager.py`
- `services/homeostasis/conflict_resolver.py`
- `services/homeostasis/adaptive_regulator.py`
- `artifacts/cortex_roadmap/r7_value_homeostasis/*`

## Dependencies
- Requires: R3, R6, R9
- Strongly coupled with: R4 (workspace arbitration), Step 11 operator controls

## Execution command
```bash
python3 /root/.openclaw/workspace/scripts/cortex_r7_value_homeostasis.py
```
