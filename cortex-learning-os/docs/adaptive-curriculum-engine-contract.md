# Adaptive Curriculum Engine v0.8 — implementation contract

## Objective anchor

Jake replied **“Build it”** to the concrete proposal for a true curriculum-learning version with adaptive concept selection, mastery tracking, spaced retesting, generated exercises, prerequisite remediation, and model-derived lesson candidates. This document freezes that scope. Do not substitute another fixed exam or a documentation-only scaffold.

## Truth boundary

This is verifier-gated external learning state and retrieval, not model-weight training. A mastery record means the declared fresh exercises were passed under the recorded conditions. A promoted lesson means a bounded candidate passed the declared independent gates. Neither means general math mastery, human-equivalent learning, autonomous self-improvement, or durable improvement beyond completed due reviews.

## Required production behavior

### 1. Curriculum planner

- Validate the complete `math-foundations-curriculum-v0` graph: unique concept IDs, known prerequisites, acyclic dependencies, and deterministic topological order.
- Select exactly one next action with this priority:
  1. overdue spaced review;
  2. explicit prerequisite repair for a failed/lapsed concept;
  3. eligible unassessed concept whose prerequisites meet the configured gate;
  4. lowest-confidence eligible learning concept;
  5. honest terminal `curriculum_currently_satisfied` when no action is due.
- Tie-break deterministically by due time, topological index, concept ID, and stable seed.
- Never select a dependent concept while a required prerequisite is below the configured mastery gate.
- Explain every selection with content-free reason codes and evidence references.

### 2. Integrity-protected mastery state

The canonical mastery state is control-plane owned. A remote worker may emit a proposed delta but may not directly mutate the canonical file.

- Persist an owner-only, atomic, HMAC-signed state with revision, curriculum/capsule IDs, policy digest, per-concept records, and applied run IDs.
- Per concept, track at least: state (`unassessed`, `learning`, `review`, `mastered`, `lapsed`, or `blocked_prerequisite`), attempts/passes/failures, consecutive passes, current review stage, last attempted/reviewed timestamps, next review time, last evidence digest, and last run ID.
- Use a frozen default spacing policy equivalent to immediate acquisition followed by 1, 7, 30, and 90-day reviews. A lapse resets or demotes review stage and schedules prerequisite/correction work.
- State transitions must be pure/deterministic, independently replayable from artifacts, idempotent by run ID, monotonic in revision, and reject tampering or policy drift.
- A perfect/no-mistake session may update verified mastery evidence but creates no lesson.

### 3. Generated exercise catalog

- Implement at least one seeded, parametrically novel, deterministic exercise family for **each of the 36 declared concepts**.
- `generateExercise({ conceptId, seed, role })` (or an equivalent stable interface) must support baseline/acquisition, correction, promotion/transfer, held-out, and spaced-review roles.
- Same inputs produce byte-equivalent items; different role/seed inputs produce fresh parameters/item IDs.
- Every expected answer must come from local deterministic code, not a model assertion. Use existing checker modes or add bounded deterministic checker modes with tests.
- Generated prompts must not reveal expected answers or lesson candidates. Generation metadata may record seed/family/oracle digest but not weaken answer isolation.
- Add catalog completeness, determinism, freshness, oracle replay, and malformed-input tests across all 36 concepts.

### 4. Prerequisite remediation

- A failed concept causes the planner to inspect its prerequisite closure.
- If prerequisite evidence is missing, weak, lapsed, or overdue, schedule the nearest unmet prerequisite before retrying the dependent concept.
- If all prerequisites remain sufficiently mastered, schedule same-concept correction/lesson work.
- Prevent loops with bounded attempts, deterministic closure traversal, explicit blocker reasons, and a session call/step budget.

### 5. Model-derived lesson candidates

The adaptive path must not copy `lessonTemplate.rule` from a fixed exam into a candidate.

- Candidate synthesis is allowed only after a genuine independently graded failed attempt.
- Invoke an approved fresh Codex/model session with structured output and no tools. Record provider/model, positive usage, runtime, prompt digest, and output digest.
- The synthesis prompt may include curriculum outcome, failed prompt, observed answer, deterministic verifier feedback, and bounded correction evidence. It must ask for a general method, scope, contraindications, and likely root cause—not the original answer.
- Validate schema, length, concept scope, prohibited content, answer leakage, contradictions, provenance, and that the rule is not merely an existing answer or fixed remediation template.
- A malformed, unsupported, tool-using, usage-free, or ungrounded candidate is quarantined and cannot affect mastery or answers.

### 6. Promotion and causal-use gate

- Freeze fresh seeded exercises before candidate evaluation.
- Require correction plus fresh transfer/retest evidence from distinct generated items and fresh sessions.
- Add a bounded paired candidate-context versus no-candidate control on identical generated items. The policy must declare minimum valid pairs, candidate accuracy, minimum lift, no-regression allowance, and exact analysis before calls.
- Separate mechanical completion from threshold pass. If the candidate provides no qualified incremental effect, preserve the evidence but do not install it live.
- Independent control-plane replay must re-grade all attempts, recompute candidate/promotion analysis, verify manifests/provenance/usage/no-tool state, and reject rewritten worker booleans.
- Only a threshold-qualified candidate with an approved narrow live activation profile may enter the existing signed lesson registry. Otherwise it remains quarantined evidence.

### 7. Detached production path

- Extend the canonical launcher so its default training mode is adaptive curriculum; retain fixed `--exam` execution only as explicit legacy/diagnostic mode.
- Heavy implementation, model calls, adaptive sessions, and repo-scale qualification run detached on Hetzner.
- Preserve worker / control-plane harvester / notifier separation.
- Define finite `maxSteps`, `maxModelCalls`, seed, curriculum/capsule IDs, policy digest, and source commit in each frozen session plan.
- Accepted terminal states: verified mastery delta with no lesson, verified threshold-qualified lesson and mastery delta, curriculum currently satisfied with no fabricated work, or structured blocker.

## Suggested modules (names may change if interfaces remain clear)

- `src/curriculum-planner.mjs`
- `src/mastery-state.mjs`
- `src/generated-exercises.mjs`
- `src/adaptive-policy.mjs`
- `src/adaptive-session.mjs`
- `src/run-adaptive-curriculum.mjs`
- `src/adaptive-verifier.mjs`
- schemas for signed mastery state, delta, frozen plan, and model-derived candidate
- launcher/worker/harvester integration under `scripts/`

Reuse existing exam grading, model provenance, manifest, promotion, exact McNemar, signed-registry, and detached-job machinery where doing so preserves truth boundaries.

## Default policy

Freeze a checked-in policy with explicit values for prerequisite mastery, spacing stages, lapse handling, session budgets, candidate synthesis limits, paired evaluation thresholds, live-profile allowlist, and expiry. Policy changes must alter a canonical digest and cannot retroactively reinterpret old runs.

## Verification requirements

- Unit tests for graph validation, deterministic selection, all state transitions, signatures/tamper rejection, idempotence, spacing, lapse, prerequisite closure, all 36 generators, and candidate validation.
- Integration tests for: new concept pass; failure with unmet prerequisite; failure with model-derived candidate; paired threshold pass; paired null result; no-mistake/no-lesson; due review; lapse/recovery; hostile artifact rewrite; source mismatch; budget exhaustion; resume/idempotence.
- No test may claim live promotion from worker-authored green fields alone.
- Local and exact Hetzner worker-environment suites must pass.
- Update package version, status, decisions, README/operating instructions, and default launcher behavior.

## Completion

Completion requires real product runtime diffs, tests, independent review/replay, authoritative push to `origin/main` and the feature branch, synchronization to both execution planes, canonical default-path verification, and bounded user-visible delivery. A worker implementation result alone is not completion.
