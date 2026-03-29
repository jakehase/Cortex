# R9 — Adaptive Routing Brain (Quality × Latency × Cost × Risk)

## Status in this checkout

**A stable routing bootstrap slice is landed in this checkout, but the full roadmap remains incomplete.**

Audit/update date: `2026-03-29`
Reference: `docs/PHASE_D_REPO_AUDIT_2026-03-29.md`

This repo now contains a routing bootstrap under `services/routing/` plus baseline/autotune scripts and artifacts. It also still has adjacent replay-oriented routing logic in `public/cortex_server/cortex_server/routers/nexus.py`.

## Objective
Turn Cortex routing into a learned, self-improving decision system that selects the best level-chain per prompt under explicit quality, latency, cost, and risk constraints.

## Why this now
Memory (R8) is implemented and hardened. The fastest multiplier on all capabilities is smarter route selection over existing levels.

## Phase
Phase D2 roadmap with a bootstrap slice now present in this checkout

## Current repo reality

### Present bootstrap files
- `services/routing/route_taxonomy.py`
- `services/routing/route_feature_pipeline.py`
- `services/routing/adaptive_router_policy.py`
- `services/routing/chain_candidate_generator.py`
- `services/routing/replay_significance.py`
- `services/routing/safety_rollback_guard.py`
- `services/routing/shadow_mode_runner.py`
- `services/routing/canary_rollout_controller.py`
- `services/routing/full_rollout_autotuner.py`
- `services/routing/counterfactual_replay_evaluator.py`
- `services/routing/operator_dashboard.py`
- `services/routing/novelty_packager.py`
- `scripts/cortex_r9_step1_baseline_telemetry.py`
- `scripts/cortex_r9_step2_route_taxonomy.py`
- `scripts/cortex_r9_step3_feature_pipeline.py`
- `scripts/cortex_r9_step4_scoring_policy.py`
- `scripts/cortex_r9_step5_candidate_generator.py`
- `scripts/cortex_r9_step6_counterfactual_replay.py`
- `scripts/cortex_r9_step7_safety_rollback.py`
- `scripts/cortex_r9_step8_shadow_mode.py`
- `scripts/cortex_r9_step9_canary_rollout.py`
- `scripts/cortex_r9_step10_full_rollout_autotune.py`
- `scripts/cortex_r9_step11_operator_dashboard.py`
- `scripts/cortex_r9_step12_novelty_packaging.py`
- `scripts/serve_r9_dashboard_local.py`
- `scripts/cortex_r9_adaptive_routing_brain.py`
- `artifacts/cortex_roadmap/r9_adaptive_routing_brain/README.md`
- `artifacts/cortex_roadmap/r9_adaptive_routing_brain/step1/*`
- `artifacts/cortex_roadmap/r9_adaptive_routing_brain/step2/*`
- `artifacts/cortex_roadmap/r9_adaptive_routing_brain/step3/*`
- `artifacts/cortex_roadmap/r9_adaptive_routing_brain/step4/*`
- `artifacts/cortex_roadmap/r9_adaptive_routing_brain/step5/*`
- `artifacts/cortex_roadmap/r9_adaptive_routing_brain/step6/*`
- `artifacts/cortex_roadmap/r9_adaptive_routing_brain/step7/*`
- `artifacts/cortex_roadmap/r9_adaptive_routing_brain/step8/*`
- `artifacts/cortex_roadmap/r9_adaptive_routing_brain/step9/*`
- `artifacts/cortex_roadmap/r9_adaptive_routing_brain/step10/*`
- `artifacts/cortex_roadmap/r9_adaptive_routing_brain/step11/*`
- `artifacts/cortex_roadmap/r9_adaptive_routing_brain/step12/*`

### Still missing for full roadmap completion
- most step-specific scripts/configs/artifacts from the full 12-step plan
- operator dashboard and novelty-packaging surfaces
- larger-scale replay datasets and canary/live rollout evidence

### Practical interpretation
Read the remainder of this document as a target architecture plus execution plan. The bootstrap slice is real, validated, and landed; the full R9 Phase D2 stack is not complete yet.

## Step-by-step execution plan

### Step 1 — Baseline telemetry lock
- Freeze current routing behavior as baseline.
- Capture 7-day baseline metrics: route choice, latency, quality proxy, cost proxy, failures, retries.
- **Gate:** baseline dataset complete and reproducible.
- Execution artifacts:
  - `scripts/cortex_r9_step1_baseline_telemetry.py`
  - `config/cortex_roadmap/r9_step1_baseline_telemetry_contract.json`
  - `artifacts/cortex_roadmap/r9_adaptive_routing_brain/step1/baseline_telemetry_dataset_latest.json`
  - `artifacts/cortex_roadmap/r9_adaptive_routing_brain/step1/baseline_telemetry_probe_latest.json`

### Step 2 — Route taxonomy + intent schema
- Define canonical intents (qa, coding, planning, incident, research, reminders, etc.).
- Map allowed level-chains by intent and risk tier.
- **Status in this checkout:** landed as a lightweight validated schema + sample validation pass.
- **Gate:** schema validated against live traffic samples.
- Execution artifacts:
  - `scripts/cortex_r9_step2_route_taxonomy.py`
  - `config/cortex_roadmap/r9_step2_route_taxonomy_contract.json`
  - `artifacts/cortex_roadmap/r9_adaptive_routing_brain/step2/route_taxonomy_schema_latest.json`
  - `artifacts/cortex_roadmap/r9_adaptive_routing_brain/step2/route_taxonomy_validation_latest.json`

### Step 3 — Feature pipeline for routing decisions
- Build prompt + context feature extraction (complexity, urgency, uncertainty, safety flags, historical success).
- Add route-context features (recent level efficacy, timeout pressure, budget state).
- **Status in this checkout:** landed as a richer feature packet with taxonomy, runtime policy, health, latency-budget, and outcome-hint context.
- **Gate:** feature completeness + drift checks pass.
- Execution artifacts:
  - `services/routing/route_feature_pipeline.py`
  - `scripts/cortex_r9_step3_feature_pipeline.py`
  - `config/cortex_roadmap/r9_step3_feature_pipeline_contract.json`
  - `artifacts/cortex_roadmap/r9_adaptive_routing_brain/step3/feature_probe_latest.json`

### Step 4 — Multi-objective scoring model
- Implement score function:
  - maximize expected quality
  - minimize latency and cost
  - enforce hard risk constraints
- Start with interpretable weighted policy; keep model-switch option open.
- **Status in this checkout:** landed as an explicit weighted scoring policy with per-candidate utility breakdowns and a replay-backed offline gate.
- **Gate:** offline replay beats baseline on composite utility.
- Execution artifacts:
  - `services/routing/adaptive_router_policy.py`
  - `services/routing/counterfactual_replay_evaluator.py`
  - `scripts/cortex_r9_step4_scoring_policy.py`
  - `config/cortex_roadmap/r9_step4_scoring_policy_contract.json`
  - `artifacts/cortex_roadmap/r9_adaptive_routing_brain/step4/replay_probe_latest.json`

### Step 5 — Candidate chain generator
- Generate top-K candidate level-chains per request.
- Enforce hard constraints: required always-on/core levels and safety/risk gates.
- **Status in this checkout:** landed as a taxonomy-constrained candidate generator with explicit core-level validation and a compliance probe.
- **Gate:** 100% constraint compliance in simulation runs.
- Execution artifacts:
  - `services/routing/chain_candidate_generator.py`
  - `scripts/cortex_r9_step5_candidate_generator.py`
  - `config/cortex_roadmap/r9_step5_candidate_generator_contract.json`
  - `artifacts/cortex_roadmap/r9_adaptive_routing_brain/step5/chain_probe_latest.json`

### Step 6 — Counterfactual replay evaluator
- Replay historical turns through candidate chains.
- Compare predicted utility vs baseline route.
- **Status in this checkout:** landed as a reproducible fixture replay set with bootstrap-scored replay as the primary measure and native bandit replay reported only as supplemental evidence.
- **Gate:** statistically significant utility lift on replay set.
- Execution artifacts:
  - `services/routing/replay_significance.py`
  - `scripts/cortex_r9_step6_counterfactual_replay.py`
  - `config/cortex_roadmap/r9_step6_counterfactual_replay_contract.json`
  - `artifacts/cortex_roadmap/r9_adaptive_routing_brain/step6/replay_probe_latest.json`

### Step 7 — Safety envelope + rollback logic
- Add hard stop conditions (quality collapse, timeout spike, risk violation).
- Add immediate rollback-to-baseline path.
- **Status in this checkout:** landed as a synthetic rollback drill suite with expectation checks and recovery-SLA validation.
- **Gate:** synthetic fault injection triggers rollback within SLA.
- Execution artifacts:
  - `services/routing/safety_rollback_guard.py`
  - `scripts/cortex_r9_step7_safety_rollback.py`
  - `config/cortex_roadmap/r9_step7_safety_rollback_contract.json`
  - `artifacts/cortex_roadmap/r9_adaptive_routing_brain/step7/rollback_probe_latest.json`

### Step 8 — Shadow mode deployment
- Run adaptive router in shadow (recommend only, no control).
- Measure disagreement with live router and expected uplift.
- **Gate:** stable uplift signal + no safety violations for 72h.
- Execution artifacts:
  - `services/routing/shadow_mode_runner.py`
  - `scripts/cortex_r9_step8_shadow_mode.py`
  - `config/cortex_roadmap/r9_step8_shadow_mode_contract.json`
  - `artifacts/cortex_roadmap/r9_adaptive_routing_brain/step8/shadow_probe_latest.json`

### Step 9 — Canary rollout
- Route 5% then 20% of eligible traffic through adaptive policy.
- Keep per-intent kill switches.
- **Gate:** quality non-regression + latency/cost within bounds.
- Execution artifacts:
  - `services/routing/canary_rollout_controller.py`
  - `scripts/cortex_r9_step9_canary_rollout.py`
  - `config/cortex_roadmap/r9_step9_canary_rollout_contract.json`
  - `artifacts/cortex_roadmap/r9_adaptive_routing_brain/step9/canary_probe_latest.json`

### Step 10 — Full rollout + auto-tuning
- Promote to default for eligible intents.
- Enable bounded periodic weight tuning from fresh outcomes.
- **Gate:** 7-day post-rollout SLO compliance.
- Execution artifacts:
  - `services/routing/full_rollout_autotuner.py`
  - `scripts/cortex_r9_step10_full_rollout_autotune.py`
  - `config/cortex_roadmap/r9_step10_full_rollout_autotune_contract.json`
  - `artifacts/cortex_roadmap/r9_adaptive_routing_brain/step10/full_rollout_probe_latest.json`

### Step 11 — Operator dashboard + controls
- Dashboard for utility, latency, cost, risk, chain distribution, rollback events.
- Add one-click policy freeze/rollback.
- **Status in this checkout:** landed as a local static dashboard, dashboard probe, and control runbook drill with honest local-stub controls.
- **Gate:** runbook drill completed successfully.
- Execution artifacts:
  - `services/routing/operator_dashboard.py`
  - `scripts/cortex_r9_step11_operator_dashboard.py`
  - `scripts/serve_r9_dashboard_local.py`
  - `config/cortex_roadmap/r9_step11_operator_dashboard_contract.json`
  - `artifacts/cortex_roadmap/r9_adaptive_routing_brain/step11/dashboard_live_local.html`
  - `artifacts/cortex_roadmap/r9_adaptive_routing_brain/step11/dashboard_probe_latest.json`

### Step 12 — Novelty packaging
- Write claim-oriented technical brief + reproducibility pack.
- Focus on dynamic multi-objective chain selection under explicit risk constraints + rollback safety envelope.
- **Status in this checkout:** landed as a claim-disciplined novelty pack with a claim map, reproducibility pack, brief, and explicit not-supported claims to prevent overstatement.
- **Gate:** internal novelty review complete with claim map.
- Execution artifacts:
  - `services/routing/novelty_packager.py`
  - `scripts/cortex_r9_step12_novelty_packaging.py`
  - `config/cortex_roadmap/r9_step12_novelty_packaging_contract.json`
  - `artifacts/cortex_roadmap/r9_adaptive_routing_brain/step12/novelty_probe_latest.json`

## Deliverables
- `config/cortex_roadmap/r9_adaptive_routing_brain_contract.json`
- `scripts/cortex_r9_adaptive_routing_brain.py`
- `docs/cortex_roadmap/R9_ADAPTIVE_ROUTING_BRAIN.md`
- `artifacts/cortex_roadmap/r9_adaptive_routing_brain/*`

## Core metrics (go/no-go)
- `quality_non_regression_rate` target: **>= 99%**
- `p95_latency_delta` target: **<= +5%** during canary, then **<= baseline**
- `cost_per_turn_delta` target: **<= baseline**
- `risk_policy_violation_count` target: **0**
- `rollback_trigger_recovery_time` target: **<= 60s**

## Dependencies
- Requires: R8 memory substrate (complete), R6 truth engine, R4 workspace arbitration.
- Strongly benefits from: R2 lifelong plasticity and R7 homeostasis governor.

## Execution command (planned)
```bash
python3 /root/.openclaw/workspace/scripts/cortex_r9_adaptive_routing_brain.py
```
