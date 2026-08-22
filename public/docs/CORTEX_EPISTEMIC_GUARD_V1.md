# Cortex Epistemic Guard v1 (Broad Reliability Fix)

Date: 2026-03-01

## Goal
Shift from one-off patching to a broad control-plane fix that reduces overconfident/duplicate recommendations and records unresolved knowledge gaps.

## Implemented in
- `cortex-brain` container
- `/app/cortex_server/routers/nexus.py`

## What it adds

1. **Universal epistemic gate on `/nexus/orchestrate`**
   - Runs for every query, not just dependability prompts.
   - Emits `epistemic_guard` with:
     - `score`
     - `confidence_band` (`high|medium|low`)
     - `passed`
     - `mode` (`confident|verify_recommended|verification_required`)
     - `reasons` and `actions`

2. **Hard contract metadata for trustability**
   - `contract.epistemic_guard = "hard"`
   - `contract.epistemic_guard_required`
   - `contract.epistemic_guard_performed`
   - `contract.epistemic_guard_passed`
   - `contract.epistemic_confidence_band`

3. **Routing marker visibility**
   - `routing_markers.epistemic_guard_required`
   - `routing_markers.epistemic_guard_performed`
   - `routing_markers.epistemic_guard_passed`
   - `routing_markers.learning_gap_recorded`

4. **Automatic verification escalation on low confidence**
   - Adds research/validation levels (`L2/L7/L22/L34/L15`) when guard fails.
   - Suppresses fastlane direct-answer mode by forcing escalated verification path.

5. **Learning-gap ledger (continuous improvement loop)**
   - Appends unresolved/low-confidence prompts to:
     - `/opt/clawdbot/state/nexus_learning_gaps.jsonl`
   - Makes unknowns explicit and recoverable, instead of silently guessing.

## Relationship to capability guard
- Capability reality-check remains active for tuning/improvement prompts.
- Epistemic guard is broader and always on.

## Validation checks (sample)
- Query: `what else should we tune for reliability?`
  - `epistemic_guard.performed=true`
  - `contract.epistemic_guard=hard`
- Query: `design a zero downtime migration plan with rollback`
  - `epistemic_guard.passed=false`
  - verification escalation applied
  - learning gap recorded in `nexus_learning_gaps.jsonl`
