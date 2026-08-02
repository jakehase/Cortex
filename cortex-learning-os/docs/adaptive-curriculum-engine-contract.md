# Adaptive Curriculum Engine v1.0 — continuous-acquisition contract

## Objective anchor

Jake directed: **“stop the reviews just keep learning.”** This contract supersedes active v0.8 spaced-review selection. It defines a finite continuous-acquisition curriculum, honest covered-once state, deterministic evidence, and an independently signed control-plane transition. It does not erase or reinterpret historical review evidence.

The current production source defaults are:

- policy `adaptive-math-phd-v1`;
- curriculum `math-phd-trajectory-v1`;
- state schema `cortex.learning_os.mastery_state.v2`;
- session plan schema `cortex.learning_os.adaptive_session_plan.v2`;
- delta schema `cortex.learning_os.mastery_delta.v2`.

The prior `adaptive-math-continuous-v1` 84-concept program and legacy
`adaptive-math-v0.8` 36-concept program remain immutable compatibility inputs
for exact verification, migration, audit, and rollback tests. They are not the
canonical active path.

## Truth boundary

`acquired` means only that the named concept was covered once by a passing, independently replayed model call under the frozen plan. A correction pass has the same bounded meaning. Acquisition evidence is not model-weight learning, durable retention, general mathematical mastery, human-equivalent learning, or autonomous self-improvement.

A candidate lesson remains failure-derived external retrieval evidence. Even a qualified candidate does not alter model weights and cannot enter the live registry without the existing independent paired gates and an approved narrow activation profile.

## Active planner

The control plane validates the complete graph before selection: unique concept IDs, known prerequisites, acyclicity, deterministic topological order, and a generator for every concept.

It selects at most one action in this order:

1. nearest unmet prerequisite for a pending genuine failure;
2. same-concept correction when prerequisites are already acquired;
3. eligible unassessed acquisition;
4. lowest-confidence eligible learning retry;
5. `curriculum_frontier_reached` when no declared work remains.

Active action roles are exactly `acquisition` and `correction`. Corrections are learning, not scheduled reviews.

Under the continuous policy:

- review selection is disabled even when a legacy `nextReviewAt` is overdue;
- new review dates are never scheduled;
- a stale future or overdue review date cannot make an `acquired` prerequisite ineligible;
- any operator directive, including `owner_authorized_early_review`, is rejected;
- `spaced-review` cannot appear in an active plan or active v2 delta;
- frontier completion makes zero model calls and cannot fabricate a lesson or busy-loop.

The legacy planner retains due-review, spacing, lapse, and early-review behavior only when explicitly loaded with the legacy graph and policy for audit/rollback tests.

## Honest signed state

The canonical store remains owner-only, atomic, HMAC-signed, revisioned, and control-plane owned. A worker receives no signing secret and can emit only an inert proposed delta.

Schema v2 concept states are:

- `unassessed`;
- `learning`;
- `acquired`;
- `blocked_prerequisite`.

Each record preserves attempts, passes, failures, consecutive pass/failure counters, last attempt, historical last review, the historical former next-review timestamp, historical review stage, last evidence digest, last run ID, and an `acquiredAt` timestamp. `nextReviewAt` must be null in every v2 record; `historicalNextReviewAt` is audit data and never an active schedule.

A verified acquisition or correction pass transitions to `acquired` without claiming mastery or retention. A genuine failure transitions to `learning` and may create bounded prerequisite or same-concept correction work. Transitions remain pure, deterministic, independently reconstructible, source/policy/curriculum bound, manifest bound, monotonic, and idempotent by the exact run receipt.

## One-shot migration

`adaptive-migrate-continuous` is the only supported schema-v1 to schema-v2 transition. It is a later control-plane operation, not a remote-worker action.

The caller must freeze the exact:

- source revision and complete signed-state digest;
- legacy curriculum and policy digests;
- target curriculum and policy digests;
- source commit, supplied twice for an explicit equality check;
- owner-only audit destination.

The migration must:

1. verify the source HMAC using the legacy graph and policy;
2. reject source revision, state, graph, policy, target, or commit drift;
3. require every legacy concept record to remain unchanged in the target graph;
4. reject concept removal and require a non-empty new frontier;
5. preserve attempt/pass/failure and consecutive counters, last evidence/run data, pending repairs, applied run IDs, and exact applied-run receipts;
6. preserve `lastReviewedAt`, the former `nextReviewAt` as inactive `historicalNextReviewAt`, and legacy review stage as historical data;
7. map legacy `review` and `mastered` to honest `acquired`;
8. retain legacy `unassessed`, map genuine learning/lapse to `learning`, and retain blocked prerequisites;
9. clear all active `nextReviewAt` values;
10. add only target-only concepts as clean `unassessed` records;
11. increment revision exactly once;
12. write a new owner-only HMAC-signed audit artifact and atomically HMAC-sign the v2 state.

An already migrated source, tampered source, repeated audit path, non-monotonic migration time, source mismatch, or legacy concept rewrite fails closed. The migration does not delete historical run artifacts or rewrite historical outcomes.

## Curriculum and assessment boundary

The source-default DAG contains 264 concepts and canonically preserves the
prior 84-node prefix.

The deterministic generator catalog is accepted only in mechanics fixtures.
Production acquisition requires a versioned external independent bank.
Each item commits immutable prompt bytes, a fixed executable checker
specification, resource limits, no-tools policy, concept/outcome/stage/track
and semantic-family identities, exact trust/deployment/campaign bindings, and
distinct author/reviewer attestations. The 264-entry acquisition registry must
be derived from those exact signed records; identifiers without bank bytes are
invalid. No such bank is checked in, so production remains blocked.

Independent fixture replay regenerates and compares the complete canonical
item, not merely its final answer. Exact, normalized set/order, bounded numeric
tolerance, and finite-choice checkers are used only where mathematically
appropriate. No model assertion, uncheckable prose, or model-as-judge result is
an oracle. Tests cover the substantive legacy 84 surfaces and the explicit
synthetic dispatch behavior across all 264 IDs without treating that coverage
as acquisition or qualification.

Legacy exercise roles, including `spaced-review`, remain available to reproduce old evidence. Active continuous plans cannot select them.

## Failure-derived candidate boundary

Candidate synthesis remains permitted only after a genuine deterministic failure. It uses a separately recorded, no-tool model call and receives bounded failure evidence, never an answer key. Schema, provenance, positive usage, exact provider/model/reasoning, read-only sandbox, tool prohibition, scope, length, contradictions, answer leakage, and fixed-template copying remain fail-closed.

Fresh correction, held-out transfer, and identical-item paired candidate/no-context trials remain independently replayed before any narrow lesson can qualify. A paired null result preserves evidence and installs nothing.

## Detached production path

The default launcher, parallel launchers, status command, and control plane
load the PhD graph and policy. The worker remains secretless and proposal-only;
verification and HMAC signing remain separate on the control plane. Production
verification additionally requires a trusted-runner signature over exact raw
provider output and the append-only provider event ledger. A worker-authored
manifest is insufficient provenance.

Each frozen plan binds source commit, source tree identity, policy/curriculum/capsule digests, base signed-state revision/digest, seed, runtime, finite budgets, selected action, and complete generated item. Accepted active terminal results are:

- `candidate_acquisition_delta`;
- `candidate_lesson_and_acquisition_delta`;
- `curriculum_frontier_reached`;
- `structured_blocker`.

The continuation supervisor permits one remote child at a time, at most 100 sessions, at most 24 hours total across resume, and at most four hours per child. It stops at the first genuine blocker, source drift, replay failure, non-advancing state, declared bound, or honest frontier.

## Required verification

Tests must cover:

- legacy revision-state signature verification against legacy inputs;
- migration signature, exact one-revision advance, audit signature, preservation, idempotence, tamper rejection, digest/source mismatch, concept removal/rewrite, and repeated migration;
- overdue and future review suppression, stale-date prerequisite eligibility, and early-review rejection;
- v2 acquisition/failure/correction transitions with no scheduled dates;
- all-concept generation, complete regeneration, oracle replay, cycles, and missing generators;
- frontier zero-call behavior;
- independent manifest, provenance, usage, no-tool, deterministic grading, delta, and source-identity replay;
- bounded continuation behavior and first-blocker termination.

Implementation tests make no real model call and do not authorize live migration or execution.
