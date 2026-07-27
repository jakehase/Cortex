# Adaptive Curriculum Operations v1.0

## Active default

The canonical launcher uses continuous acquisition:

```bash
./scripts/launch-live-math-training.sh --dry-run
./scripts/launch-live-math-training.sh
```

The control plane loads `adaptive-math-continuous-v1` and `math-continuous-acquisition-v1`. It selects only acquisition, learning retry, prerequisite correction, or same-concept correction. It never creates or waits for a review schedule.

`--early-review` is retained only as a fail-closed compatibility flag. It exits with an error under the active policy. Do not use it to bypass the continuous policy.

Fixed exams remain explicit legacy diagnostics:

```bash
./scripts/launch-live-math-training.sh --exam baseline
./scripts/launch-live-math-training.sh --exam challenge
./scripts/launch-live-math-training.sh --exam stress
```

## Control-plane migration

Do not edit or re-sign revision 74 manually. Before migration, separately preserve the original owner-only state and audit its exact signature, state digest, legacy graph digest, legacy policy digest, source commit, and revision.

The migration command requires every frozen identity:

```bash
npm run live:adaptive:migrate-continuous -- \
  --audit-out <new-owner-only-audit.json> \
  --source-commit <40-hex-source-commit> \
  --expected-source-commit <same-40-hex-source-commit> \
  --expected-source-revision 74 \
  --expected-source-state-digest <sha256> \
  --expected-source-curriculum-digest <sha256> \
  --expected-source-policy-digest <sha256> \
  --expected-target-curriculum-digest <sha256> \
  --expected-target-policy-digest <sha256>
```

Run it once on the control plane only. It verifies the legacy HMAC with the legacy graph/policy, refuses legacy concept removal or rewriting, preserves counters/evidence/receipts/historical review data (including the former next-review timestamp as inactive `historicalNextReviewAt`), clears every active `nextReviewAt`, converts legacy review/mastered records to `acquired`, adds exactly the new graph concepts as `unassessed`, advances revision exactly once, writes an owner-only HMAC audit, and atomically signs the v2 state.

For the declared canonical revision-74 input, the expected target revision is 75 with 36 migrated legacy records and 48 new unassessed records. Confirm those counts from the signed output; do not assume them if the source digests do not match. A target state or audit already present, a repeated invocation, a mismatched digest, source drift, a signature failure, or a non-monotonic timestamp is a hard stop.

This repository implementation does not itself run the live migration.

## One-session operation

`--dry-run` performs source/runtime preflight and freezes a signed control-plane plan without a model call. A real active worker may return:

- `candidate_acquisition_delta`;
- `candidate_lesson_and_acquisition_delta`;
- `curriculum_frontier_reached`;
- `structured_blocker`.

`curriculum_frontier_reached` is an honest terminal result. It makes no model call, advances no acquisition revision, creates no lesson, schedules no review, and must not trigger a relaunch loop.

The remote worker receives a signed plan but no HMAC secret. It emits generated exercises, raw call provenance, deterministic attempt records, optional failure-derived candidate evidence, a manifest, and an inert proposed delta. It cannot mutate signed acquisition state or the live registry.

The harvester applies a delta only after exact independent replay of:

1. safe regular-file manifest coverage, byte sizes, and SHA-256 values;
2. source commit/tree, policy, curriculum, capsule, and base signed-state identities;
3. the complete generated item and oracle digest;
4. deterministic grading and score totals;
5. exact provider/model/xhigh/read-only/no-tool runtime with positive provider-observed usage;
6. genuine failure linkage and candidate schema/provenance when a candidate exists;
7. identical-item fresh-session paired analysis and frozen thresholds when applicable;
8. byte-equivalent reconstruction of the proposed v2 delta.

Only then may the control plane atomically HMAC-sign the next revision. Exact run receipts make byte-identical reapplication idempotent and reject artifact substitution under a reused run ID.

## Continuous supervisor

For an operator-authorized bounded continuation:

```bash
./scripts/launch-adaptive-math-continuation.sh --dry-run
./scripts/launch-adaptive-math-continuation.sh
```

The supervisor stays on the control plane and launches one detached Hetzner child at a time. It records the child before waiting, resumes the same child after supervisor interruption, waits for independent replay/signing, and requires the signed acquisition revision to advance before another child.

Hard limits are:

- one active child;
- no more than 100 sessions;
- no more than 24 total wall-clock hours, measured from the persisted continuation start across resume;
- no more than four hours per child;
- stop on the first genuine blocker.

It also stops on source drift, plan/replay failure, non-advancing state, missing state, infrastructure failure, or `curriculum_frontier_reached`. Per-child notifications stay suppressed; the independent control-plane notifier reports the terminal result.

## State interpretation

Schema-v2 `acquired` means covered once. A pass or genuine correction creates no future review date. A failure enters `learning` and may create a bounded correction; a correction is not a review.

Historical `lastReviewedAt`, inactive `historicalNextReviewAt`, and legacy review stage remain visible for audit, but do not affect active eligibility. Never relabel them as new retention evidence. Never describe `acquired` as mastered, retained, or a successful spaced review.

## Recovery

Do not edit state, signatures, plans, manifests, raw call ledgers, audit artifacts, or historical run outcomes manually. Preserve the exact artifact directory and continuation state for diagnosis.

A signature mismatch, source mismatch, policy/curriculum drift, malformed generator item, oracle mismatch, rewritten manifest, runtime/provenance/usage/tool failure, budget exhaustion, or state non-advance is a structured blocker. Fixing infrastructure does not authorize rewriting a completed outcome or rerunning a result for a preferred answer.

Generated weighted-mean exercises continue to accept an exact fraction or a decimal within deterministic absolute tolerance `1e-9`. Failed candidate synthesis continues to preserve its exact prompt and raw call ledger for replay.

## Truth boundary

Continuous acquisition records bounded model-call performance on named deterministic exercises. It does not make the model learn new weights, demonstrate durable retention, establish general math mastery, prove semantic coding transfer, or authorize a live lesson. Those claims remain separate and unproven unless their own gates are satisfied.
