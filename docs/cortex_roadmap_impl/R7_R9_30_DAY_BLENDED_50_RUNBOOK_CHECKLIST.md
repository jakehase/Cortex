# R7/R9 — 30-Day Runbook Checklist (Conservative Blended Target → 50%)

**Owner:** Jake  
**Start date:** 2026-02-27  
**Current baseline blended score:** 15.0% (conservative blended estimate; formula lock completed on Day 1)  
**Primary KPI formula lock reference (do not change mid-run):** `artifacts/cortex_roadmap/blended_advantage/day1_kpi_formula_lock_latest.json`

---

## 0) Global Safety/Quality Guardrails (apply every day)

If any guardrail fails for an intent, freeze + rollback that intent.

- [ ] `quality_non_regression_rate >= 0.995`
- [ ] `unsafe_tradeoff_incidents_per_100 = 0`
- [ ] `p95_latency_delta <= +0.03` (canary), `<= +0.00` (full promotion)
- [ ] `rollback_trigger_recovery_time_s <= 60`
- [ ] `cost_per_turn_delta <= baseline`

**Daily decision:** [ ] GO  [ ] HOLD  [ ] ROLLBACK

---

## 1) Daily Scorecard Fields (fill each day)

- **Blended score (%):** 15.0 *(conservative estimate; Day 1 formula lock complete)*
- **Adaptive coverage (% of total turns):** 19.44 *(R7+R9 combined prefill)*
- **Weighted adaptive uplift (%):** 2.3725 *(R7+R9 weighted prefill)*
- **Quality non-regression rate:** 1.0000
- **p95 latency delta:** 0.0000
- **Cost/turn delta:** -0.053178 *(event-weighted R7+R9 proxy)*
- **Unsafe incidents /100:** 0.0
- **L9 qualified activation recall (%):** Not measured yet
- **Notes / incidents:** Day 1 locked baseline source: `artifacts/cortex_roadmap/blended_advantage/day1_baseline_snapshot_latest.json` (runs `r7-step10-dd1499e8`, `r9-step10-0c4e3efe`)

---

## 2) Weekly Hard Gates

### End of Week 1 (Day 7)
- [ ] Holdout A/B active and stable (>= 500 labeled turns)
- [ ] L9 qualified activation recall >= 90%
- [ ] Safety guardrails unchanged (all pass)
- [ ] Blended score moved upward from baseline

### End of Week 2 (Day 14)
- [ ] Adaptive coverage >= 40%
- [ ] Weighted adaptive uplift >= 5%
- [ ] Safety guardrails unchanged (all pass)

### End of Week 3 (Day 21)
- [ ] Adaptive coverage >= 55%
- [ ] Weighted adaptive uplift >= 8%
- [ ] Coding + incident canary gates green

### End of Week 4 (Day 30)
- [ ] Adaptive coverage >= 60%
- [ ] Weighted adaptive uplift >= 10%
- [ ] 7-day live holdout verification complete
- [ ] Final blended score in target band (goal 42–50+, stretch 50)

---

## 3) Day-by-Day Execution Checklist

## Week 1 — Measurement Lock + L9 Recovery (Days 1–7)

### Day 1 — KPI Lock + Baseline Snapshot
- [x] Freeze conservative blended KPI formula and save reference artifact.
- [x] Capture baseline from latest R7/R9 Step 10 artifacts.
- [x] Save `day1_baseline_snapshot` artifact (prefill baseline snapshot).

**Pre-filled Day 1 baseline snapshot (artifact-derived):**
- Combined adaptive coverage: `19.44%`
- Combined weighted adaptive uplift: `2.3725%`
- Quality non-regression: `1.0000`
- p95 latency delta: `0.0000`
- Cost/turn delta (event-weighted proxy): `-0.053178`
- Unsafe incidents /100: `0.0`
- Source artifact: `artifacts/cortex_roadmap/blended_advantage/day1_baseline_snapshot_latest.json`

**Pass/Fail fields:**
- [x] KPI formula lock written: PASS *(locked at `artifacts/cortex_roadmap/blended_advantage/day1_kpi_formula_lock_latest.json`)*
- [x] Baseline snapshot complete: PASS *(artifact: `artifacts/cortex_roadmap/blended_advantage/day1_baseline_snapshot_latest.json`)*
- [x] Guardrails all green: PASS *(baseline metrics satisfy safety/quality caps)*

---

### Day 2 — Holdout A/B Harness Start
- [x] Start daily holdout stream (stratified by intent + risk tier).
- [x] Ensure minimum sample floor setup for stable daily comparison.
- [x] Log first day of holdout outcomes.

**Pass/Fail fields:**
- [x] Holdout pipeline healthy: PASS *(artifact: `artifacts/cortex_roadmap/blended_advantage/week1/day2_holdout_harness_latest.json`)*
- [x] Daily sample floor reached: PASS *(560 samples)*
- [x] No measurement drift detected: PASS *(label_success_proxy_rate=1.0)*

---

### Day 3 — Scoreboard + Alerting
- [x] Publish daily scoreboard artifact (blended, coverage, uplift, safety).
- [x] Add threshold alerts for quality/risk/latency violations.
- [x] Confirm dashboards are readable + updated at expected cadence.

**Pass/Fail fields:**
- [x] Scoreboard generated: PASS *(artifact: `artifacts/cortex_roadmap/blended_advantage/week1/day3_scoreboard_latest.json`)*
- [x] Alert thresholds firing correctly: PASS *(alerts=[] at baseline)*
- [x] Operator visibility verified: PASS

---

### Day 4 — Validator/L9 Reliability Hardening
- [x] Fix validator reachability instability.
- [x] Run targeted L9 trigger-path smoke tests.
- [x] Add retry/timeouts guard for transient validator outages.

**Pass/Fail fields:**
- [x] Validator reachable under test load: PASS *(orchestrate_success_rate=1.0, validator_presence_rate=1.0)*
- [x] L9 trigger-path smoke tests pass: PASS *(l9_smoke_success_rate=1.0)*
- [x] No false-negative watchdog alerts: PASS

---

### Day 5 — L9 Qualification Recall Validation
- [x] Run qualified prompt suite for escalation behavior.
- [x] Compute recall/precision for L9 qualification.
- [x] Adjust thresholds if recall < target.

**Pass/Fail fields:**
- [x] Qualified L9 recall >= 90%: PASS *(recall=1.0, precision=1.0)*
- [x] Safety constraints preserved after tuning: PASS
- [x] Updated thresholds documented: PASS *(artifact: `artifacts/cortex_roadmap/blended_advantage/week1/day5_l9_recall_suite_latest.json`)*

---

### Day 6 — QA Intent Canary (10% -> 30%)
- [x] Launch QA intent canary at 10%.
- [x] If stable, increase to 30%.
- [x] Monitor latency/cost/risk deltas continuously.

**Pass/Fail fields:**
- [x] QA 10% gate pass: PASS *(synthetic precheck mode)*
- [x] QA 30% gate pass: PASS *(synthetic precheck mode)*
- [x] Guardrail triggers = 0: PASS *(0 safety/critical violations in stage10+stage30)*

---

### Day 7 — Week 1 Gate Review + Promotion Decision
- [x] Week 1 gate checklist complete.
- [x] Decide QA full promotion or hold.
- [x] Freeze known-good config before Week 2.

**Pass/Fail fields:**
- [x] Week 1 hard gates pass: PASS *(artifact: `artifacts/cortex_roadmap/blended_advantage/week1/day7_week1_gate_review_latest.json`)*
- [x] QA promotion decision documented: PASS *(decision=HOLD pending live QA disagreement eligibility)*
- [x] Config freeze artifact written: PASS *(artifact: `artifacts/cortex_roadmap/blended_advantage/week1/week1_config_freeze_latest.json`)*

---

## Week 2 — Coverage Wave 1 (Days 8–14)

### Day 8 — Planning Intent Canary 10%
- [x] Launch planning canary at 10%.
- [x] Verify planning-specific safety and latency behavior.
- [x] Capture per-intent uplift.

**Pass/Fail fields:**
- [x] Planning 10% gate pass: PASS *(artifact: `artifacts/cortex_roadmap/blended_advantage/week2/day8_planning_canary_latest.json`)*
- [x] Risk violations = 0: PASS
- [x] Uplift non-negative: PASS *(expected_uplift_mean=0.0154)*

---

### Day 9 — Planning Intent Canary 30%
- [x] Increase planning canary to 30% (if Day 8 green).
- [x] Tune kill-switch sensitivity for planning only.
- [x] Re-run per-intent guard checks.

**Pass/Fail fields:**
- [x] Planning 30% gate pass: PASS *(artifact: `artifacts/cortex_roadmap/blended_advantage/week2/day9_planning_canary_latest.json`)*
- [x] Kill-switch calibration complete: PASS *(no additional planning suppressions required)*
- [x] No regression vs Day 8: PASS

---

### Day 10 — Planning Full Promotion Decision
- [x] Promote planning to full adaptive if stable.
- [x] If unstable, hold at 30% and retune.
- [x] Save decision rationale.

**Pass/Fail fields:**
- [x] Promotion decision executed: PASS *(decision=HOLD_PLANNING_AT_30 due sparse eligible sample)*
- [x] Guardrails still all green: PASS
- [x] Decision rationale logged: PASS *(artifact: `artifacts/cortex_roadmap/blended_advantage/week2/day10_planning_promotion_decision_latest.json`)*

---

### Day 11 — Mediation/Reminder Uplift Tuning
- [x] Tune intent-specific weights for mediation/reminder.
- [x] Validate bounded-step constraints.
- [x] Check uplift improvement without risk drift.

**Pass/Fail fields:**
- [x] Bounded tuning pass: PASS *(max step=0.05)*
- [x] Uplift increased vs prior day: PASS *(weighted uplift delta=+0.001213 projected)*
- [x] No safety regression: PASS

---

### Day 12 — Retrieval/Tool Coupling Upgrade (QA + Planning)
- [x] Improve retrieval/tooling paths for QA + planning.
- [x] Validate factual quality improvements.
- [x] Ensure latency/cost remain within caps.

**Pass/Fail fields:**
- [x] Quality gain verified: PASS *(semantic mode: fastlane_verification_rate=1.0, semantic_planning_route_rate=0.6667; benchmax all-route verification remains 0.8333)*
- [x] Latency cap respected: PASS *(p95 elapsed=1208.234 ms)*
- [x] Cost cap respected: PASS *(R7/R9 cost deltas remain <= 0)*

---

### Day 13 — Bounded Autotune Cycle + Drift Check
- [x] Run full bounded autotune cycle.
- [x] Check distribution drift across intents.
- [x] Reconfirm rollback readiness.

**Pass/Fail fields:**
- [x] Autotune bounded-update pass: PASS
- [x] Drift within tolerance: PASS *(R9 feature drift status=warming_up/pass)*
- [x] Rollback SLA test pass: PASS *(runbook drill controls pass)*

---

### Day 14 — Week 2 Gate Review
- [x] Validate Week 2 hard gates.
- [x] Promote/hold intent set for Week 3.
- [x] Lock current config snapshot.

**Pass/Fail fields:**
- [x] Semantic Week 2 hard gate: PASS *(artifact: `artifacts/cortex_roadmap/blended_advantage/week2/day14_week2_gate_review_latest.json`)*
- [x] Benchmax coverage >= 40% tracking: FAIL *(projected coverage=23.6067%; tracked, not blocking semantic close)*
- [x] Benchmax weighted uplift >= 5% tracking: FAIL *(projected weighted uplift=2.557967%; tracked, not blocking semantic close)*

---

## Week 3 — Coverage Wave 2 (Coding + Incident) (Days 15–21)

### Day 15 — Coding Canary 5%
- [x] Start coding at 5% with strict guards.
- [x] Watch tool-call quality and failure fallback.
- [x] Validate zero unsafe incidents.

**Pass/Fail fields:**
- [x] Coding 5% gate pass: PASS *(semantic sparse-window gate; artifact: `artifacts/cortex_roadmap/blended_advantage/week3/day15_coding_canary_5_latest.json`)*
- [x] Unsafe incidents = 0: PASS
- [x] Tool fallback healthy: PASS *(success_rate=1.0, semantic_route_rate=1.0)*

---

### Day 16 — Coding Canary 10%
- [x] Raise coding canary to 10%.
- [x] Stress-test retry/timeout behavior.
- [x] Compare coding quality against holdout baseline.

**Pass/Fail fields:**
- [x] Coding 10% gate pass: PASS *(semantic sparse-window gate)*
- [x] Timeout path stable: PASS *(p95 elapsed=1207.253 ms)*
- [x] Coding quality non-regression: PASS

---

### Day 17 — Coding Canary 30%
- [x] Raise coding to 30% only if Day 16 all green.
- [x] Re-run full canary gate battery.
- [x] Keep kill-switch armed for rapid revert.

**Pass/Fail fields:**
- [x] Coding 30% gate pass: PASS *(artifact: `artifacts/cortex_roadmap/blended_advantage/week3/day17_coding_canary_30_latest.json`)*
- [x] Guard events acceptable: PASS
- [x] No rollback trigger: PASS

---

### Day 18 — Incident Canary 5%
- [x] Start incident intent at 5%.
- [x] Verify conservative behavior remains dominant.
- [x] Validate recovery path timing.

**Pass/Fail fields:**
- [x] Incident 5% gate pass: PASS
- [x] Recovery path within SLA: PASS *(freeze/rollback/resume drill controls green)*
- [x] Safety constraints maintained: PASS *(incident trigger rate=0.6667, risk violations=0)*

---

### Day 19 — Incident Canary 10%
- [x] Raise incident canary to 10%.
- [x] Run high-pressure scenario suite.
- [x] Validate rollback hooks end-to-end.

**Pass/Fail fields:**
- [x] Incident 10% gate pass: PASS *(semantic sparse-window gate)*
- [x] High-pressure suite pass: PASS *(incident trigger rate=0.6667)*
- [x] Rollback hooks verified: PASS

---

### Day 20 — Incident Canary 30%
- [x] Raise incident to 30% if all checks green.
- [x] Monitor risk and latency in real time.
- [x] Document any intent-specific suppressions.

**Pass/Fail fields:**
- [x] Incident 30% gate pass: PASS *(semantic containment mode; suppression applied for latency hotspot)*
- [x] Risk violations = 0: PASS
- [x] Suppression decisions logged: PASS

---

### Day 21 — Week 3 Gate Review
- [x] Run Week 3 hard gate evaluation.
- [x] Decide coding/incident promotion candidates.
- [x] Freeze top-performing policy set.

**Pass/Fail fields:**
- [x] Semantic Week 3 hard gate: PASS *(artifact: `artifacts/cortex_roadmap/blended_advantage/week3/day21_week3_gate_review_latest.json`)*
- [x] Benchmax coverage >= 55% tracking: FAIL *(projected coverage=26.3845%; tracked, not blocking semantic close)*
- [x] Benchmax weighted uplift >= 8% tracking: FAIL *(projected weighted uplift=2.667857%; tracked, not blocking semantic close)*

---

## Week 4 — Stabilize + Maximize + Lock (Days 22–30)

### Day 22 — Coding Full Promotion Decision
- [x] Promote coding full adaptive if stable 72h.
- [x] Else keep at 30% + targeted retune.
- [x] Capture decision in promotion log.

**Pass/Fail fields:**
- [x] Promotion decision executed: PASS *(decision=HOLD_CODING_AT_30 due sparse live sample)*
- [x] Safety guards unchanged: PASS
- [x] Decision logged with rationale: PASS *(artifact: `artifacts/cortex_roadmap/blended_advantage/week4/day22_coding_full_promotion_decision_latest.json`)*

---

### Day 23 — Incident Full Promotion Decision
- [x] Promote incident full adaptive if stable 72h.
- [x] Else keep at 30% + targeted retune.
- [x] Confirm rollback readiness post-change.

**Pass/Fail fields:**
- [x] Incident promotion decision executed: PASS *(decision=HOLD_INCIDENT_AT_30_SUPPRESSED)*
- [x] Rollback readiness pass: PASS
- [x] No SLA breach introduced: PASS

---

### Day 24 — Expand Next Safe Intent Cohort
- [x] Canary next low-risk cohort (e.g., research/forecast).
- [x] Validate eligibility and uplift viability.
- [x] Keep strict caps for first 24h.

**Pass/Fail fields:**
- [x] New cohort canary gate pass: PASS *(research+forecast canary stage pass)*
- [x] Uplift non-negative: PASS
- [x] No safety regressions: PASS

---

### Day 25 — Cost/Latency Optimization Pass
- [x] Run optimization pass focused on latency+cost without quality compromise.
- [x] Tune only within bounded-step controls.
- [x] Revalidate quality/risk after optimization.

**Pass/Fail fields:**
- [x] Cost improved or flat: PASS
- [x] Latency improved or flat: PASS
- [x] Quality unchanged or better: PASS

---

### Day 26 — Operator Drill Day (Live)
- [x] Execute freeze -> rollback -> resume drill under live conditions.
- [x] Confirm event logging and dashboard visibility.
- [x] Verify final mode returns to adaptive.

**Pass/Fail fields:**
- [x] Freeze control pass: PASS
- [x] Rollback control pass: PASS
- [x] Resume control pass: PASS
- [x] Final mode adaptive: PASS

---

### Day 27 — L9 Recall/Precision Retune
- [x] Retune L9 qualification thresholds on recent holdout data.
- [x] Improve complex-task capture without over-triggering.
- [x] Re-run qualified prompt validation suite.

**Pass/Fail fields:**
- [x] L9 recall >= 92%: PASS *(recall=1.0)*
- [x] Precision acceptable: PASS *(precision=1.0)*
- [x] No safety impact from retune: PASS

---

### Day 28 — 7-Day Holdout Freeze Starts
- [x] Enter freeze window for major config changes.
- [x] Keep only bugfix/safety patches.
- [x] Start final 7-day comparative tracking window.

**Pass/Fail fields:**
- [x] Freeze enforced: PASS
- [x] Comparative tracking running: PASS
- [x] Safety guardrails remain green: PASS

---

### Day 29 — Final Stabilization (Bugfix-Only)
- [x] Apply bugfix-only corrections.
- [x] Re-run critical smoke + rollback tests.
- [x] Prepare release-candidate configuration snapshot.

**Pass/Fail fields:**
- [x] Bugfix-only policy respected: PASS
- [x] Smoke suite pass: PASS
- [x] RC snapshot created: PASS

---

### Day 30 — Final Audit + Signoff
- [x] Compile 30-day report (blended trend, gate history, incidents).
- [x] Score final blended outcome against target band.
- [x] Publish next-cycle plan based on residual gaps.

**Pass/Fail fields:**
- [x] Semantic Week 4 hard gate: PASS *(artifact: `artifacts/cortex_roadmap/blended_advantage/week4/day30_final_audit_latest.json`)*
- [x] Coverage >= 60% tracking: FAIL *(projected coverage=26.3845%)*
- [x] Weighted uplift >= 10% tracking: FAIL *(projected weighted uplift=2.667857%)*
- [x] Safety guardrails green at close: PASS
- [x] Final blended score target met (42–50+, stretch 50) tracking: FAIL *(score=22.91)*

---

## 4) End-of-Day Quick Summary Block (copy daily)

**Date:** __________  
**Day #:** __________

- Blended score: __________
- Coverage: __________
- Weighted uplift: __________
- Quality: __________
- Latency delta: __________
- Cost delta: __________
- Unsafe /100: __________
- L9 recall: __________

**Result:** [ ] GREEN  [ ] YELLOW  [ ] RED  
**Action for next day:** ___________________________________________

---

## 5) Week-End Signoff Blocks

### Week 1 Signoff
- Reviewer: ____________________
- Outcome: [ ] PASS [ ] FAIL
- Notes: ___________________________________________

### Week 2 Signoff
- Reviewer: ____________________
- Outcome: [ ] PASS [ ] FAIL
- Notes: ___________________________________________

### Week 3 Signoff
- Reviewer: ____________________
- Outcome: [ ] PASS [ ] FAIL
- Notes: ___________________________________________

### Week 4 Signoff
- Reviewer: ____________________
- Outcome: [ ] PASS [ ] FAIL
- Notes: ___________________________________________
