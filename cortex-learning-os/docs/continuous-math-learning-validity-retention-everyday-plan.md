# Continuous Mathematics Learning, Validity, Retention, and Everyday Cortex Plan

## 1. Status and anchor

- Program ID: `clos-continuous-math-evidence-use-v1`
- Planning date: `2026-08-08`
- Reply anchor: Jake said, “Scratch this plan. Let's just continue the learning, create a plan to start learning more math. At the same time we need to test the validity and retention and then how we can utilize it in everyday Cortex.”
- Active planning branch: `feat/cortex-learning-os-continuous-math-evidence-20260808`
- Product anchor: the live signed transfer registry exposes `264/264` canonical mathematics concepts to the everyday Cortex path as `operator_direct` profiles.
- Superseded plan: `clos-phd-equivalence-usefulness-v1` on branch `feat/cortex-learning-os-phd-equivalence-usefulness-20260808` is historical only and must not drive work. Its commit remains immutable audit history; it is not an active roadmap.
- Current fidelity: plan only. This document does not launch model calls, mutate signed acquisition/retention state, change live routing, or claim new learning evidence.

## 2. Objective

Create one ongoing, evidence-bearing loop that:

1. Continues through the existing 264-concept mathematics trajectory in prerequisite order.
2. Distinguishes concepts Cortex already handles from concepts that require a new trusted lesson or correction.
3. Validates each claimed improvement on independent, disjoint problems.
4. Tests retention in calendar-separated windows while acquisition continues in parallel.
5. Measures whether the mathematics actually helps normal Cortex work.
6. Promotes only scoped, verified, useful guidance into stronger everyday use.
7. Keeps expanding after the current frontier through source-grounded gap discovery rather than stopping at one static checklist.

“Learning” in this program means signed evidence, verified retrievable lessons, corrected strategies, and improved task performance. It does **not** mean model-weight training unless a separate weight-training program is explicitly approved and evidenced.

## 3. Existing paths to extend

The plan extends existing production primitives rather than building a parallel learning system:

- Curriculum: `capsules/math-foundations/curriculum.phd-trajectory-v1.graph.json` (`264` concepts).
- Acquisition policy: `policies/adaptive-math-phd-v1.json`.
- Acquisition runtime: adaptive plan/worker/harvester/control-plane signed-state path.
- Retention policy: `policies/phd-retention-v1.json`.
- Retention runtime: existing task, release, job-build, grade, status, wait, resume, and campaign verifier commands.
- Transfer/runtime path: signed transfer registry, deterministic concept router, bounded context renderer, and content-free telemetry under `plugins/cortex-learning-os-live/`.
- Heavy execution boundary: detached Hetzner worker; control-plane replay/signing/notifier remain local.

Known truth boundaries:

- `acquired` means covered once, not retained or mastered.
- The active acquisition policy intentionally schedules no routine reviews.
- The production retention policy is separate and currently requires two declared-unseen windows, at least seven days apart, with disjoint items/theorems and signed chain bindings.
- Checked-in generated exercises are fixture-only for production qualification; real acquisition/retention requires independently authored, reviewed, signed assessment banks.
- All 264 live profiles are operator-available, not independently proven useful.

## 4. Four concurrent evidence lanes

The program runs four separate lanes with separate state and claims.

### Lane A — Continuous acquisition

Purpose: cover new concepts, identify real gaps, create bounded corrections, and advance signed acquisition state.

For each selected concept:

1. Verify prerequisites from signed state.
2. Freeze one independently authored acquisition item and exact checker.
3. Run a fresh no-tools `gpt-5.6-sol`/`xhigh` session.
4. If Cortex passes, record `acquired_once`; do not fabricate a lesson.
5. If Cortex fails, classify the error, construct a source-grounded candidate lesson/correction, and evaluate it on identical-item fresh-session treatment/control pairs.
6. Promote the lesson only if the existing paired thresholds pass under independent replay.
7. Apply the inert delta only through control-plane signature verification.
8. Select the next grounded concept; never repeat merely to force a pass.

Acquisition remains continuous even while retention windows are waiting. A due retention job uses its own lane and budget instead of turning the acquisition planner back into a review scheduler.

### Lane B — Near-term validity and generalization

Purpose: establish that an acquisition result was mathematically valid and not a one-item accident.

For every newly acquired or corrected concept, schedule a disjoint validity pack within 24–72 hours:

- at least two unseen item families
- one direct application
- one compositional, proof, counterexample, error-diagnosis, or implementation task appropriate to the concept
- no target answer or promoted lesson text in the item authoring context
- deterministic checker where possible; separately authenticated review where formal deterministic grading is insufficient
- source/provenance and contamination check

Validity states remain separate:

```text
acquired_once
validity_pending
validity_confirmed
validity_failed
validity_blocked
```

A validity failure does not erase historical acquisition evidence. It creates a scoped gap/correction candidate and prevents stronger retention or utility claims.

### Lane C — Time-separated retention

Purpose: test whether verified strategies remain usable after elapsed time and fresh-session boundaries.

Reuse the production `phd-retention-v1` trust path. Do not fake elapsed time or use early practice as retention credit.

Retention windows:

- **R7:** two declared-unseen signed windows separated by at least seven elapsed days, satisfying the existing production policy.
- **R30:** a fresh disjoint window at or after 30 days.
- **R90:** an optional durable window at or after 90 days for stronger long-term wording.

All windows require:

- fresh sessions
- disjoint item and theorem-family IDs
- exact prior-window digest chaining
- independently authored/reviewed signed retention banks
- no target answers, prior outputs, or lesson prose exposed beyond the ordinary runtime treatment under test
- positive provider-observed usage and exact runtime provenance
- independent grading and state application

Retention claims are explicit:

```text
retention_unproven
retention_r7_confirmed
retention_r30_confirmed
retention_r90_confirmed
retention_lapsed
retention_blocked
```

A lapse creates a correction/reacquisition task but cannot be relabeled as a pass.

### Lane D — Everyday Cortex utility

Purpose: determine when and how mathematical guidance helps real Cortex work.

Everyday status tiers:

1. `operator_available` — currently available through the signed 264-profile router; no efficacy claim.
2. `validity_confirmed` — concept has independent near-term validity evidence.
3. `retention_confirmed` — concept or declared cohort has elapsed-time evidence.
4. `utility_candidate` — applicable real task families and deterministic/expert outcomes exist.
5. `utility_qualified` — preregistered treatment/control evidence shows useful lift without regression.
6. `everyday_preferred` — qualified guidance may receive stronger ranking on matched requests.

The current operator profiles remain honestly labeled. This program does not retroactively call them qualified.

Everyday evidence sources:

- low-sensitivity, permissioned real tasks
- reproducible coding/scientific-computing fixtures derived without client or personal data
- hidden deterministic tests
- proof/counterexample checks
- user corrections as **candidate signals only**
- content-free activation telemetry

Raw private chats, client records, credentials, source code, or personal data may not be copied into learning artifacts. A real conversation may yield a de-identified problem-family proposal only after privacy review and, when needed, explicit user approval.

## 5. Truth-layer ledger and surface matrix

Create a machine-readable 264-row evidence matrix. One row per concept must contain:

- curriculum identity, stage, tracks, and prerequisites
- acquisition state and exact evidence digest
- validity state, item-family coverage, score, and timestamp
- retention R7/R30/R90 states and chained window digests
- lesson/correction IDs and expiry
- transfer/router profile identity
- observed everyday activation counts without prompt content
- utility family, treatment/control run, effect estimate, and gate result
- everyday-use tier
- blockers, contraindications, and allowed/disallowed claims

Required aggregate counts:

```text
unassessed
learning
acquiredOnce
validityConfirmed
retentionR7
retentionR30
retentionR90
utilityCandidates
utilityQualified
everydayPreferred
blocked
```

No completion percentage may be guessed from profile count or artifact volume.

## 6. Curriculum selection and continued expansion

### Selection policy inside the 264-concept trajectory

Choose the next concept using:

1. prerequisite readiness
2. unassessed/learning state
3. stage progression
4. track diversity
5. observed everyday applicability
6. prior validity or retention gaps
7. bounded call budget

Recommended rolling budget allocation:

- 70% acquisition/correction
- 20% validity and due retention
- 10% utility qualification and everyday-gap analysis

This split is a planning default, not an evidence threshold. A due signed retention window must not be skipped merely to improve acquisition counts.

### Expansion after or beyond the current frontier

When the 264-node frontier is reached—or everyday tasks expose a genuine missing prerequisite—the program may propose new concepts only through:

- trusted source citations
- clear outcome and prerequisite DAG placement
- novelty/overlap check against all existing concepts
- authored exercise families and independent checkers
- rubric/track mapping
- explicit non-goals and truth boundary
- review before activation

A proposed concept is not learned, live, or qualified merely because it was added to a backlog.

## 7. Assessment-bank contract

Separate material into three independently governed sets:

1. **Learning/source packs:** definitions, theorems, examples, and references Cortex may study.
2. **Acquisition/validity banks:** unseen items proving immediate understanding/generalization.
3. **Retention/utility banks:** calendar-separated or real-task items never visible during acquisition.

Production requirements:

- immutable prompt/checker bytes
- exact graph, rubric, policy, deployment, and campaign binding
- unique seed-independent family per concept where required
- distinct authenticated author and reviewer identities
- no synthetic fixture credit
- rights/provenance record for every source
- secretless remote worker
- control-plane-only grading/signing authority

The first implementation milestone must inventory whether valid live banks already exist. Missing banks are a precise blocker, not permission to use generated fixtures as production evidence.

## 8. Validity and retention thresholds

Final thresholds must be frozen before each scored cohort. Initial defaults:

### Per-concept validity

- all required item families valid
- at least 80% aggregate score
- no critical logical, proof, or safety error
- compositional/application item passes
- zero answer-key leakage or undeclared tools

### Production R7 retention

Reuse `phd-retention-v1` exactly unless a versioned policy change is separately implemented:

- two windows
- at least seven days separation
- at least 19 items per window
- at least 80% score per required evaluation
- at least three stages and fifteen tracks for the declared broad cohort
- disjoint item/theorem IDs and prior-window digest chain

### R30/R90 extension

- fresh disjoint bank
- same or stricter score and integrity requirements
- separately report concept, stage, and track negative space
- do not pool an easy cohort to hide a lapsed track

A threshold failure is retained as evidence. Outcome-driven reruns on the same bank are prohibited.

## 9. Everyday utility qualification

### Initial target profiles

Begin with a small, high-frequency cross-section selected from live telemetry and task demand, likely including:

- numerical stability and conditioning
- matrix decomposition/linear solvers
- constrained optimization
- probability/statistical inference
- graph flow/matching
- stochastic reliability
- causal analysis
- state invariants/counterexamples

The exact list is frozen only after a content-free live-usage audit.

### Treatment/control design

For each utility family:

- treatment: frozen Cortex with the selected math context
- control: identical Cortex session configuration without that context
- byte-identical task statement
- fresh session per arm
- balanced arm order
- hidden deterministic tests or blind expert rubric
- task-family cluster as the statistical unit
- unrelated-task regression controls
- full cost, latency, and usage capture

Initial utility gate per promoted family:

- at least 24 valid paired task-family clusters
- treatment accuracy at least 85%
- absolute accepted-solution lift at least 15 percentage points
- more treatment-only than control-only wins
- exact two-sided McNemar `p <= 0.05`
- zero critical control-only regression
- no unacceptable unrelated-task regression
- configured context stays within its bound

Before execution, calibrate for floor/ceiling feasibility using disjoint non-scored tasks. A ceiling-limited corpus cannot support a failed or passed lift claim.

### Everyday runtime behavior

- `operator_available`: may render bounded guidance under current explicit operator policy.
- `utility_qualified`: eligible for evidence-weighted ranking and longer expiry.
- overmatching, contradiction, expired evidence, or repeated utility failure: lower rank, disable, or revoke the profile without affecting acquisition history.
- the answer must still be independently reasoned and verified; retrieved guidance is never an answer key.

## 10. Everyday feedback loop

For normal Cortex work:

1. Router selects at most three concept profiles.
2. Telemetry records content-free profile IDs, reason codes, evidence tier, latency, and answer-influence boolean.
3. Deterministic task checks or explicit user corrections may create a quarantined gap candidate.
4. A privacy-safe task family is authored independently from the raw conversation.
5. The gap enters acquisition, validity, retention, or utility planning as appropriate.
6. No user correction or single successful answer directly mutates trusted lessons, signed state, or utility status.
7. Periodic reports show useful activations, false activations, corrections, and missing surfaces without storing prompt content.

This closes the loop between academic learning and everyday usefulness without learning directly from secrets or self-grading live answers.

## 11. Execution and agent strategy

### Control plane

- freeze plans, source, policy, bank, and state digests
- select one bounded child at a time
- verify and sign state transitions
- maintain the four truth ledgers
- consume returned artifacts
- run independent notifier
- stop on first genuine blocker

### Hetzner execution plane

- execute heavy fresh-session model calls
- receive signed plans/banks but no HMAC or grading authority
- emit raw provider ledger, attempts, outputs, inert deltas, and manifest
- never mutate canonical state or live registry

### Role separation

- source/lesson author
- assessment author
- assessment reviewer
- worker
- deterministic/expert grader
- control-plane harvester
- utility statistician/auditor

The learner cannot author or grade its own scored evidence. Multi-agent orchestration may parallelize independent bank authoring or replay, but state-changing execution remains serialized by concept/run receipt.

## 12. Supervisor and cadence

Recommended initial cadence after readiness:

- one bounded acquisition child at a time
- 1–4 new concept sessions per day depending provider budget and blocker rate
- validity packs scheduled 24–72 hours after acquisition
- retention jobs released only at genuine R7/R30/R90 times
- weekly utility-candidate review from content-free telemetry
- monthly evidence/negative-space report

Existing hard continuation limits remain the starting safety boundary:

- one active child
- at most 100 sessions per bounded continuation
- at most 24 total hours per continuation across resume
- at most four hours per child
- stop on first blocker, state non-advance, source drift, frontier, or budget exhaustion

A supervisor terminal state ends one bounded wave, not the overall learning objective. The next wave is generated from signed matrix gaps, due retention windows, and everyday utility candidates.

## 13. Initial 30-day wave

### Phase 0 — Live truth and readiness audit

- verify exact canonical source commit/tree
- inspect signed acquisition, lesson, retention, and transfer states live
- count true state categories; do not infer from memory
- inventory valid signed acquisition and retention banks
- confirm Hetzner worker/runtime and notifier readiness
- write a blocker if the independent bank or remote boundary is missing

### Phase 1 — Select the next cohort

- select up to 24 prerequisite-ready concepts across at least six tracks
- prefer unassessed concepts with likely everyday relevance while preserving stage diversity
- freeze source packs, acquisition items, validity packs, and future retention-family commitments
- preserve item secrecy across lanes

### Phase 2 — Continue acquisition

- run bounded detached sessions through the existing acquisition path
- independently replay and sign only valid deltas
- record acquired/pass, genuine correction, lesson promotion, null, frontier, or blocker honestly

### Phase 3 — Validate concurrently

- schedule disjoint validity packs 24–72 hours after each acquisition
- gate stronger evidence states on validity, not acquisition count
- route failures back to scoped correction without rewriting original outcomes

### Phase 4 — Start retention clocks

- freeze R7 releases and window commitments at acquisition/validity time
- continue new acquisition while the calendar advances
- execute R7 only after real elapsed time
- schedule R30 for concepts/cohorts that pass R7

### Phase 5 — Test everyday utility

- use content-free live telemetry to choose 4–8 high-frequency concept/task families
- run disjoint non-scored calibration
- execute paired utility qualification only after the contract is frozen
- mark passing profiles `utility_qualified`; preserve null/red outcomes

### Phase 6 — Thirty-day report and next wave

Report exact counts for every truth layer, concept/stage/track negative space, costs, blockers, false activations, utility effects, and scheduled future retention windows. Generate the next cohort from actual matrix gaps.

## 14. Artifact and replay contract

Authoritative root:

```text
/root/clawd/artifacts/cortex-learning-os-continuous-math/<campaign-id>/
```

Required artifacts:

```text
contract.json
source-freeze.json
live-state-snapshot.json
curriculum-surface-matrix.json
bank-inventory.json
cohort-plan.json
acquisition-state.json
validity-state.json
retention-state.json
utility-state.json
everyday-tier-registry.json
runner-events.jsonl
provider-call-ledger.jsonl
manifest.json
integrity-report.json
threshold-evaluation.json
truth-conflicts.json
completion-summary.json
blocker-report.json           # when blocked/red
next-wave-plan.json
```

Each state-changing receipt binds exact run ID, source, policy, curriculum, bank, base state, provider ledger, output, checker, and manifest digests.

## 15. Reporting contract

Every report separates:

1. profile/catalog availability
2. acquisition completed once
3. near-term validity
4. R7/R30/R90 retention
5. runtime activation
6. causal everyday utility
7. broad curriculum negative space
8. model-weight learning, which remains unclaimed

Examples:

- Allowed: `38/264 acquired once; 24 validity-confirmed; 19 R7-confirmed; 4 utility-qualified.`
- Disallowed: `The system knows 264 concepts` because 264 profiles exist.
- Disallowed: `retained` from a process restart or immediate retest.
- Disallowed: `useful` from activation counts, positive anecdotes, or a green hidden test without a control.

## 16. Risks and controls

| Risk | Control |
|---|---|
| Generated fixtures masquerade as learning evidence | Production accepts only independent signed banks |
| One-item pass inflated to mastery | Separate acquisition, validity, and retention ledgers |
| Retention clock bypassed | Signed release time, real wall clock, chained disjoint windows |
| Existing 264 active profiles overstate usefulness | Preserve `operator_available`; add evidence tiers |
| Everyday prompts leak private data | Content-free telemetry; independently authored de-identified fixtures |
| Self-authored/self-graded evidence | Capability-separated authors, reviewers, workers, graders, and signers |
| Outcome-driven reruns | Immutable scored outcome; new version requires disjoint bank |
| Ceiling/floor-limited utility trial | Disjoint calibration before frozen scored corpus |
| Acquisition stops at fixed backlog | Generate next wave from matrix gaps and grounded frontier proposals |
| Heavy execution overloads control plane | Hetzner-only model farm; local control plane and notifier |
| Raw LOC/profile count used as progress | Evidence-state counts and negative-space matrix only |

## 17. Implementation sequence

After explicit approval to implement:

1. Build the live-state/audit adapter and 264-row evidence matrix by extending existing state readers.
2. Add separate validity ledger and scheduler without changing `acquired` semantics.
3. Connect existing retention task/release/wait/resume primitives to acquired cohorts and real calendar windows.
4. Add evidence-tier fields to transfer/runtime telemetry and registry entries without relabeling operator activation.
5. Build privacy-safe everyday utility candidate intake and paired evaluator.
6. Add one focused smoke for each code change, then apply that change; do not start a broad regression campaign unless a concrete risk requires it and Jake approves.
7. Run Phase 0 live audit.
8. If readiness is green, launch the first bounded acquisition cohort on Hetzner with independent notifier.
9. Continue validity, retention, and utility lanes according to their frozen schedules.

Planning is not implementation. No phase is claimed complete until its product surfaces and evidence artifacts exist.

## 18. Machine stop and continuation conditions

Per-wave terminal condition:

```text
wave.completed_with_signed_state_and_manifest
or curriculum_frontier_reached
or precise_blocker_reported
or bounded_budget_exhausted
```

Overall program condition is intentionally ongoing:

```text
continue generating grounded acquisition, validity, due-retention, and utility work
while unresolved evidence-matrix rows or approved frontier expansions exist
```

A future full-matrix claim requires exact evidence, not a semantic one-shot:

```text
for every in-scope concept:
  acquisition state is explicit
  validity state is explicit
  due retention windows are explicit
  everyday utility state is explicit
and all truth conflicts are zero
```

## 19. Immediate next milestone

Implement **Phase 0 only** first:

- inspect live signed states and banks
- produce the exact 264-row evidence matrix
- identify the next prerequisite-ready cohort
- report the real readiness blocker, if any
- make no model call and no live state mutation

Once that audit is green, ask for or apply the already-established execution approval boundary for the first bounded Hetzner acquisition wave.

## 20. Truth boundary

This plan is a practical route to continuous, testable mathematics learning and everyday utility. It is not evidence that learning, retention, or usefulness has occurred.

The strongest future claims remain layer-specific and versioned. The program must preserve failures, null results, lapses, false activations, and missing coverage as first-class evidence instead of optimizing for a green narrative.
