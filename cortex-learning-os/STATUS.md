# Cortex Learning OS Status

## Metadata

- Project slug: `cortex-learning-os`
- Canonical plan: `/root/clawd/cortex-learning-os/plan.md`
- Decisions log: `/root/clawd/cortex-learning-os/DECISIONS.md`
- Last updated: `2026-07-25 11:13 CDT`
- Status: `active`
- Current fidelity: `production_slice`
- Package version: `0.3.0`

## Current checkpoint

Cortex Learning OS has completed its first bounded, verifier-gated learning loop for the math-foundations capsule. The implementation is integrated into the authoritative remote `main`; the verified implementation commit is `b03add355` and its first lifecycle/documentation integration commit is `944808d72`. The feature branch `feat/cortex-learning-os-v0-20260725` is preserved at that integration point.

The production slice now includes:

- 21 machine tests covering contracts, deterministic checkers, fail-closed promotion, retrieval limits, curriculum coverage, learning-loop behavior, paired randomization, strict Codex structured output, frozen-runtime resume enforcement, exact McNemar analysis, and Codex tool-event detection.
- 14 JSON record schemas plus internal contract validation.
- A 36-concept math-foundations curriculum.
- A 30-item deterministic baseline exam, a 20-item exactness/reliability challenge, and a 20-item exact-arithmetic stress exam.
- Recorded no-tool OpenClaw/Cortex answer capture with provider/model/usage provenance.
- Attempt records, verifier results, mistake records, candidate lessons, promotion reports, trusted lessons, retrieval packs, capability reports, and hashed manifests.
- Canonical default capsule files under `capsules/math-foundations/`.
- A preregistered randomized paired A/B harness for 27 identical-item pairs / 54 fresh Codex sessions, at least 24 valid pairs, deterministic grading, fail-closed invalid-trial handling, and separate mechanical versus evidence thresholds.

## Latest qualified evidence

- Qualified pointer: `artifacts/latest-qualified-run.json`
- Artifact root: `artifacts/math-foundations-smoke-20260725-052939567Z`
- Artifact manifest: 36 files, direct SHA-256 replay check `36/36` matched.
- Model path: OpenClaw isolated/non-delivering agent sessions; provider `openai-codex`; model `gpt-5.6-sol`; no tools declared.
- Exact-arithmetic stress baseline: `19/20` (`0.95`), with one deterministic multi-digit multiplication failure.
- Correction: `1/1` passed.
- Independent promotion retest: `1/1` passed.
- Promotion gate: all 10 gates passed; lesson `lesson_e30152a45fdf9a6a` promoted with 90-day retest date.
- Held-out post-promotion retest: `1/1` passed using the canonical 336-token retrieval pack.
- Canonical default update: completed (`defaultPromoted=true`).
- Latest local validation: `npm test` passed `14/14`; `npm run validate:fixtures` passed with 12 valid records and 1 intentionally invalid record.
- Latest A/B branch validation: `npm test` passed `21/21`; fixtures passed; paired plan-only and fake-worker lifecycle smokes froze and completed successfully before the real A/B model calls.

## Latest randomized A/B evidence

- Experiment: `math-foundations-paired-ab-20260725T1600Z`.
- Exact execution source: branch `feat/cortex-learning-os-ab-20260725`, commit `bde94bf4f872a75e7c744bc9b37c9b91e41a9600`.
- Mechanical result: completed `54/54` fresh ephemeral Codex trials across all `27/27` valid pairs; zero invalid trials and zero observed tool events.
- Provider evidence: model `gpt-5.6-sol`; usage present for `54/54` trials; `795,631` input tokens, `352,000` cached input tokens, `24,304` output tokens, and `22,374` reasoning-output tokens recorded.
- Paired outcome: both arms passed `26/27` (`96.2963%`); `25` both-pass pairs, `0` both-fail pairs, `1` pack-only win, and `1` no-pack-only win.
- Estimated effect: absolute pack lift `0`; two-sided exact McNemar p-value `1.0`.
- Evidence gate: **not passed**. The run is mechanically green but provides no bounded evidence that the retrieval pack helped or harmed under this declared configuration.
- Artifact verification: the control-plane return bundle checksum passed and all `464/464` manifest-listed files matched SHA-256.

Additional honest evidence:

- The initial 30-item baseline scored `30/30`; the loop stopped rather than fabricating a mistake: `artifacts/math-foundations-smoke-20260725-052255174Z`.
- The corrected reliability challenge scored `20/20`; it also stopped without fabricating a mistake: `artifacts/math-foundations-smoke-20260725-052716583Z`.
- An earlier reliability-challenge run was invalid because the generated derangement oracle incorrectly expected `0`. Cortex's answers `D_10=1334961` and `D_6=265` were correct. That root is preserved only as verifier-regression evidence under `artifacts/_quarantine/false-derangement-oracle-20260725-052532795Z/` and produced no candidate/default promotion.

## Active blockers / unproven surfaces

- The completed bounded production slice remains green.
- The randomized A/B executed successfully, but its preregistered evidence threshold did not pass: both arms scored `26/27`, lift was `0`, and exact McNemar p was `1.0`.
- Broad or durable math improvement remains unproven.
- Retrieval-pack benefit and harm remain unproven under the declared exact-multiplication/model/runtime configuration.
- Ordinary Cortex task routing does not yet auto-select a Learning OS capsule outside the explicit CLOS run path.
- Model weights were not changed.

## Next actions

1. Preserve this completed threshold miss as an honest null result; do not enable ordinary-task retrieval routing from it.
2. Before any new efficacy run, redesign difficulty to avoid the observed `96.3%` ceiling while retaining identical paired items, fresh sessions, deterministic grading, and frozen thresholds.
3. Require a new preregistered out-of-sample threshold pass before considering repeated durability checks or a bounded default pre-task hook with rollback and token limits.

## Do not use / superseded

- Do not treat AI OS, SLOS, or Cortex/Codex consolidation as this project; they are related assets, not the CLOS implementation path.
- Do not use the quarantined false-derangement run as learning or capability evidence.
- Do not treat deterministic expected-answer fixtures as model capability evidence.

## Truth boundary

Allowed claims:

- Cortex Learning OS has a working, artifact-backed production slice.
- One bounded exact-arithmetic failure was followed by passed correction, independent promotion retest, and a different held-out retest after a gated retrieval pack.
- One scoped lesson passed the declared promotion gates and is available on the canonical capsule path.

Not allowed:

- Cortex broadly learned mathematics.
- The retrieval pack alone caused the held-out pass.
- The improvement is durable across sessions or time.
- Cortex is an expert mathematician, quant PM, or profitable trader.
- Model weights changed.
- Live trading or external financial actions are approved.
