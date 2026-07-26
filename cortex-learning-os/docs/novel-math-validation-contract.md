# Cortex Learning OS — Novel-Math Validation Contract v0

## Reply anchor

Jake approved the harder math-learning benchmark proposed on 2026-07-25: novel mathematical rules unavailable from pretraining, calibrated no-context headroom, acquisition and promotion, disjoint held-out transfer, compositional generalization, ordinary-math regression controls, and artifact-backed retrieval after a clean process restart.

This is a new preregistered validation. It does not alter or reinterpret the completed multiplication A/B result.

## Claim under test

Whether the Learning OS can, under one declared model/runtime:

1. observe a failure caused by a missing invented mathematical definition;
2. use correction and independent retest evidence to promote that definition;
3. retrieve the promoted lesson in fresh sessions;
4. apply it to disjoint direct and compositional problems;
5. avoid material interference with ordinary arithmetic; and
6. reload the unchanged promoted lesson from disk in a distinct process and retain the paired effect.

A pass supports only:

`bounded_acquisition_retention_and_fresh_session_generalization_for_one_seeded_novel_mathematical_microtheory`

It does not support broad math improvement, general mathematical mastery, human-like durable learning, autonomous self-improvement, or model-weight learning.

## Frozen design

- Benchmark: `cortex.learning_os.novel_math_benchmark.v0`
- Provider: OpenAI Codex
- Model: `gpt-5.6-sol`
- Reasoning effort: `low`
- Worker: ephemeral, read-only sandbox, user configuration and rules ignored
- Tools: forbidden; any observed tool event invalidates that trial
- Real-work evidence: every planned call must record positive runtime, matching provider/model metadata, and positive provider-observed input and output tokens; the worker must be the default `codex` command resolving to a versioned `@openai/codex` executable whose real path and SHA-256 remain stable from preregistration through verification
- Test workers: any explicit worker-command override is nonclaimable even if all synthetic efficacy gates pass
- Sessions: unique fresh session for every model call
- Reruns: no outcome-driven reruns; completed invalid trials remain invalid
- Checker: deterministic exact-string or exact-integer grading
- Total maximum model calls: **225**

### Call budget

| Phase | Calls | Purpose |
|---|---:|---|
| Disjoint calibration | 12 | Confirm no-context headroom on a different invented algebra |
| Acquisition | 3 | Baseline failure, correction pass, independent retest pass |
| Direct paired transfer | 60 | 30 identical-item pack/no-pack pairs |
| Compositional paired transfer | 60 | 30 identical-item pack/no-pack pairs |
| Ordinary-math regression | 50 | 25 identical-item irrelevant-pack/no-pack pairs |
| Post-restart durability | 40 | 20 identical-item pack/no-pack pairs in a distinct process |

## Mathematical task

The seed deterministically creates a named private algebra over ordered integer pairs with:

- a noncommutative binary operator containing linear and bilinear terms under two moduli;
- a unary transform under the same moduli; and
- explicit innermost-first composition rules.

The target microtheory is generated and frozen before model calls. No-pack prompts contain the system name and expression but not its definition. Pack prompts receive only the lesson promoted by the frozen acquisition phase. Expected answers are stored in the preregistered program but never included in model prompts.

Calibration uses a separately named, separately seeded, definition-disjoint algebra. Calibration outcomes cannot count as target efficacy wins.

## Frozen gates

### Calibration

- At least 11/12 valid items
- Invalid rate ≤10%
- No-pack accuracy ≤20%
- Failure stops before acquisition and held-out calls

### Acquisition and promotion

All are required:

- Valid no-context baseline call fails
- Valid correction call passes
- Valid independent compositional retest passes
- Mistake and negative example are recorded
- Two passing reproducible verifier results cover two active exams
- Required retest passes
- Candidate is contradiction-free and scoped by contraindication
- Trusted lesson is written to disk

Failure stops before paired target trials.

### Direct transfer — 30 pairs

- At least 27 valid pairs; invalid rate ≤10%
- Pack accuracy ≥85%
- No-pack accuracy ≤20%
- Absolute lift ≥50 percentage points
- Pack-only wins exceed no-pack-only wins
- Two-sided exact McNemar p ≤0.01
- No-pack-only pairs ≤1
- Mean input-token overhead ≤1,200
- Median latency overhead ≤10 seconds
- Retrieval pack ≤900 estimated tokens

### Compositional transfer — 30 pairs

Same gates as direct transfer, except pack accuracy must be ≥80%.

The expressions are disjoint from acquisition and include nested binary/unary forms. This is bounded structural transfer, not recall of acquisition answers.

### Ordinary-math regression — 25 pairs

The pack arm deliberately receives the irrelevant target lesson as a conservative interference stress.

- At least 23 valid pairs; invalid rate ≤10%
- Pack-arm ordinary-math accuracy ≥96%
- `no_pack_accuracy - pack_accuracy` ≤2 percentage points
- No-pack-only pairs ≤1
- Retrieval pack ≤900 estimated tokens

Normal selective routing should omit this lesson for ordinary arithmetic; this track tests the harsher accidental-retrieval case.

### Clean-process restart — 20 pairs

- Immediate runner writes a checkpoint containing the promoted-lesson digest and exits
- Durability runs in a separate Node process with a different random process nonce
- Second process starts after the checkpoint timestamp
- Program digest and promoted-lesson digest remain unchanged
- Second process reloads the trusted lesson from disk
- At least 18 valid pairs; invalid rate ≤10%
- Pack accuracy ≥85%
- No-pack accuracy ≤20%
- Absolute lift ≥50 percentage points
- Exact McNemar p ≤0.01
- No-pack-only pairs ≤1
- Same token and latency caps as efficacy tracks

This proves one artifact-backed process boundary, not long-duration retention.

## Preregistration and source integrity

`--plan-only` must run first. It writes:

- the full generated program, items, answers, schedules, sessions, and thresholds;
- SHA-256 of the complete program;
- exact Git commit;
- SHA-256 of every source file involved in generation, execution, retrieval, grading, and promotion.

Execution requires `--resume` and fails closed if the program, source commit, source files, runtime arguments, or worker command drift.

## Stop condition and truth layers

Stop at one of:

1. frozen calibration early no-go;
2. frozen acquisition/promotion early no-go;
3. terminal blocker;
4. all 225 calls complete, followed by independent artifact recomputation.

Report separately:

- preregistered/baseline-ready;
- mechanical green;
- threshold pass;
- independent artifact integrity;
- allowed claim.

Mechanical green is not threshold pass. A verified no-go remains a completed benchmark, not a learning success. A fake-worker lifecycle may prove harness mechanics and frozen outcome recomputation, but it cannot set the real benchmark's `thresholdPass` or support a model-learning claim.

## Execution boundary

The control-plane host may author, test, sync, monitor artifacts, and notify. Real model calls run detached on the Hetzner execution plane. The detached launcher must invoke the immediate process, confirm `awaiting_restart`, invoke a new durability process, run the independent verifier, package artifacts, and return them to the control plane. A notifier monitors authoritative state independently of the heavy process.
