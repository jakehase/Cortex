# Applied Mathematics Transfer Qualification v1

Status: frozen design candidate; no scored model calls are authorized until the local contract tests and canary plan verifier pass.

## 1. Question

Does a compact, frozen retrieval treatment derived from a representative subset of the Cortex Learning OS PhD-mathematics trajectory cause measurable improvement on genuinely unseen coding, systems-reasoning, and machine-checked formal-problem tasks, compared with the same model and prompts without that treatment?

This is an external-memory intervention test. It does not test or claim model-weight change.

## 2. Exact anchor

- Source commit: `55ca78a723f678c1c8bb17ae90e73649075156e9`
- Source branch: `feat/phd-math-retention-successor-20260803`
- Qualification branch: `feat/cortex-learning-os-applied-math-transfer-20260808`
- Target package: `cortex-learning-os`
- Model: `gpt-5.6-sol`
- Reasoning effort: `xhigh`
- Execution plane: Hetzner `jake@37.27.129.239`
- Control and signing plane: `/root/clawd`

## 3. Truth layers

The run reports these independently:

1. **Acquisition source** — whether the source concept record is present and signed.
2. **Treatment integrity** — whether the exact pack is immutable, independently authored, size-bounded, and task-blind.
3. **Retention** — whether the unchanged pack and its concept mappings pass authenticated replay after restart in two disjoint windows.
4. **Integration** — whether compositional tasks requiring at least two declared concepts pass deterministic hidden verifiers.
5. **Transfer efficacy** — whether paired treatment improves exact task success under frozen thresholds.
6. **Semantic safety** — whether irrelevant tasks receive no treatment and ordinary coding does not regress.
7. **Routing eligibility** — whether all preceding gates permit a later shadow-routing proposal.
8. **Activation** — a separate operator-approved configuration change; never performed by this benchmark.

No lower layer implies a higher one.

## 4. Existing evidence and blocker

The August 5 retention attempt produced deterministic answer comparison `19/19`, but its persisted raw model records have `runnerAttestation: null`. Authenticated grade application failed closed with:

```text
retention trusted raw execution failed: trusted execution attestation signature mismatch; answer/output binding mismatch
```

That attempt remains useful raw mathematical evidence but receives no retained-mastery credit and causes no canonical mutation. This phase must either repair and test the trusted-runner path prospectively or stop with a blocker. It must not synthesize or backdate an attestation for the old run.

## 5. Representative concept bundle

The treatment author may use only the declared graph records and non-scored, task-neutral mathematical references for these concept IDs:

- `numerical-analysis-floating-point-error`
- `numerical-analysis-conditioning`
- `graph-theory-matchings-flows`
- `combinatorics-matroids`
- `number-theory-chinese-remainder`
- `proof-invariants-and-extremal-principles`
- `proof-counterexample-construction`
- `optimization-duality-kkt`
- `linear-algebra-matrix-decompositions`
- `stochastic-processes-markov-chains`
- `differential-equations-stability-lyapunov`
- `statistics-causal-identification`

A pass is representative-subset evidence only. It is not evidence that all 264 concepts transferred.

## 6. Author separation and leakage controls

### Treatment author

May see:

- the 12 declared graph records;
- this section's treatment schema and size limit;
- task-neutral requirements for mathematical correctness, assumptions, failure modes, and implementation heuristics.

Must not see:

- scored task statements, APIs, filenames, hidden tests, seeds, expected outputs, reference implementations, or task-family identifiers.

Output:

- one JSON treatment bundle with concept cards;
- at most 1,800 whitespace-delimited words across retrievable card text;
- no executable code longer than three consecutive lines;
- explicit assumptions and misuse warnings;
- SHA-256 frozen before integration.

### Task author

May see:

- the generic candidate submission interface;
- allowed language/runtime and sandbox limits;
- the three declared domains: coding, systems reasoning, and machine-checked formal problems;
- the number of families/variants required.

Must not see:

- the treatment bundle, treatment wording, retrieval keys, or author prompt.

Output:

- public task statements and submission interfaces;
- hidden deterministic tests/oracles;
- task metadata containing concept mappings for audit, kept out of model prompts;
- no answer-bearing hints;
- SHA-256 frozen before integration.

### Integrator

May combine only already-frozen author outputs. Any post-freeze content change creates a new benchmark version and invalidates earlier results. The integrator may repair harness defects only if both content digests remain unchanged and no scored outputs have been inspected.

## 7. Smallest meaningful canary

Before the full run, execute one paired canary on the `stable-mergeable-moments` family:

- one task-author output frozen without treatment access;
- one treatment-author output frozen without task access;
- randomized arm order;
- fresh model session per arm;
- identical task bytes in both arms;
- treatment arm differs only by the bounded retrieved concept cards;
- no tools or network for model calls;
- candidate submission extracted by a deterministic parser;
- candidate code run under a time/memory-bounded local verifier with hidden tests;
- second-process artifact replay and manifest verification.

The canary proves only that the experiment transaction is real and auditable. One pair cannot support an efficacy claim.

## 8. Full scored program

The full transfer program contains 30 paired transfer tasks: 10 frozen families with 3 hidden variants each. It also contains 10 paired ordinary-coding regression tasks: 5 unrelated families with 2 variants each. Total scored paired trials: 80 model calls. Canary and retention calls are reported separately and receive no transfer-effect credit.

Each pair uses:

- byte-identical public task and submission instructions;
- the same model, reasoning effort, token budget, timeout, and no-tools policy;
- independent fresh sessions;
- randomized arm order fixed before execution;
- a candidate arm with only the mapped concept cards appended;
- a no-pack arm with no mathematical pack;
- exact deterministic hidden verification;
- zero retries after a semantically valid model response;
- one infrastructure retry only when provider evidence proves no response was produced, with both attempts retained and the retry policy applied symmetrically.

The surface matrix is frozen in `benchmarks/applied-math-transfer-v1/surface-matrix.json`.

## 9. Retention and restart requirement

A retained-transfer claim requires two disjoint windows using the identical treatment SHA-256:

- Window A: authenticated concept checks plus the first scored transfer campaign.
- Window B: new items and seeds, launched in a clean runner process at least 24 hours after Window A.

Both windows must verify:

- exact pack digest and concept mapping;
- task-bank disjointness;
- raw provider event/output binding;
- trusted-runner signature;
- deterministic checker replay;
- no canonical mutation on any failed replay.

Window A may prove immediate use. It cannot alone prove time-separated retention.

## 10. Frozen thresholds

### Mechanical validity

- exactly 80/80 scored transfer/regression calls produce one valid bound result;
- zero invalid scored trials;
- every call has a unique planned session ID, non-null worker/model command, positive runtime, provider-observed usage, exact prompt hash, exact raw-output hash, and zero tool events;
- every candidate is verified exactly once by the frozen checker;
- every returned artifact is covered by a manifest and replayed independently.

### Transfer efficacy

Across the 30 transfer pairs:

- candidate accuracy `>= 0.875`;
- no-pack accuracy `>= 0.75`;
- candidate minus no-pack accuracy `>= 0.125`;
- pack-only wins exceed no-pack-only wins;
- two-sided exact McNemar `p <= 0.05`;
- at least 8 of 10 families have candidate accuracy at least no-pack accuracy;
- coding, systems, and formal domains each have candidate accuracy at least no-pack accuracy.

### Integration

- all accepted compositional items declare at least two bundle concepts before execution;
- candidate passes at least 80% of compositional items;
- no family receives credit from keyword matching, prose explanation, or self-grading; only hidden executable verification counts.

### Semantic safety and regression

- zero irrelevant-task treatment injections under the frozen eligibility mapping;
- across 10 paired ordinary-coding tasks, candidate accuracy must be at least no-pack accuracy;
- no candidate-only security, resource, determinism, or API-contract regression;
- treatment length and latency remain within the policy limits.

### Retention

- both disjoint windows pass authenticated replay;
- treatment digest is unchanged after process restart;
- no retrospective or synthesized runner attestation;
- any failed replay blocks retained-transfer and routing-eligibility claims.

## 11. Outcome states

- `canary_blocked`: smallest transaction could not be proven.
- `canary_green_full_run_not_started`: harness/provenance proof only.
- `mechanical_blocker`: missing or invalid execution evidence; no efficacy decision.
- `verified_threshold_no_go`: mechanically valid full run completed but one or more frozen efficacy/safety thresholds failed.
- `window_a_transfer_pass_retention_pending`: immediate transfer passed; time-separated retention unproven.
- `bounded_retained_integrated_transfer_pass`: every transfer, safety, provenance, and two-window retention gate passed.
- `shadow_routing_eligible_not_activated`: prior state plus an independently verified eligibility report; no production configuration change.

## 12. Disallowed claims

This benchmark cannot establish:

- retained mastery of all 264 concepts;
- human-like understanding or a PhD degree;
- model-weight learning;
- verified Lean theorem proving unless a separately trusted Lean kernel is installed and exact artifacts pass it;
- autonomous novel mathematical research;
- general coding superiority outside the frozen surfaces;
- production answer-path safety or activation.

## 13. Artifacts and replay

Every run root must contain at least:

```text
contract.snapshot.md
policy.snapshot.json
surface-matrix.snapshot.json
author-separation/
preregistration.json
calls/<trial-id>/
verifier/<trial-id>.json
analysis.json
campaign-state.json
manifest.json
independent-verification.json
```

The implementation must expose plan-only, canary, run, analyze, and verify commands. Exact replay commands are written into the run root before any scored call.
