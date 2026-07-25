# Cortex Learning OS Status

## Metadata

- Project slug: `cortex-learning-os`
- Canonical plan: `/root/clawd/cortex-learning-os/plan.md`
- Decisions log: `/root/clawd/cortex-learning-os/DECISIONS.md`
- Last updated: `2026-07-25 13:35 CDT`
- Status: `active`
- Current fidelity: `production_slice_plus_preregistered_go_no_go_harness`
- Package version: `0.4.0`

## Current checkpoint

Cortex Learning OS has completed its first bounded, verifier-gated learning loop for the math-foundations capsule. The implementation is integrated into the authoritative remote `main`; the verified implementation commit is `b03add355` and its first lifecycle/documentation integration commit is `944808d72`. The feature branch `feat/cortex-learning-os-v0-20260725` is preserved at that integration point.

The production slice now includes:

- 26 machine tests covering contracts, deterministic checkers, fail-closed promotion, retrieval limits, curriculum coverage, learning-loop behavior, paired randomization, strict Codex structured output, frozen-runtime resume enforcement, exact McNemar analysis, Codex tool-event detection, dual-track go/no-go planning, cost/no-regression gates, and fail-closed fixture/runtime validation.
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

## Approved capped go/no-go validation

- Reply anchor: Jake approved the recommendation to give the underlying lesson/retrieval idea one rigorous bounded chance: novel synthetic mechanism transfer plus recurring private-workspace utility, with no default integration unless both pass.
- Harness: 3-call synthetic acquisition/promotion gate, then 27 mechanism pairs and 27 private-utility pairs in fresh ephemeral sessions; 111 model calls maximum.
- Preregistered per-track gates: at least 24 valid pairs, invalid rate no greater than 10%, at least 20-point lift, exact McNemar p no greater than 0.05, at most one no-pack-only regression, mean input overhead no greater than 1,200 tokens, pack estimate no greater than 900 tokens, and median latency overhead no greater than 10 seconds.
- Privacy: the nine-rule/27-item utility fixture is outside the public repository and passed a targeted credential/email/IP/secret-pattern scan.
- Local validation: `npm test` passed `26/26`; real-fixture plan smoke froze 111 calls and 108 unique transfer sessions without model calls; fake-worker full lifecycle completed 105/105 calls for the reduced 24-item test fixture, promoted acquisition, passed both synthetic tracks, and replayed every manifest hash.
- Terminal execution: `111/111` model calls completed; acquisition promoted; all `108/108` transfer trials and `54/54` pairs were valid; zero observed tool events; usage recorded on every transfer trial.
- Mechanism result: **passed** — pack `27/27`, no-pack `0/27`, absolute lift `100` points, exact McNemar p `1.5e-8`; all cost/no-regression gates passed.
- Utility result: **threshold not passed** — pack `27/27`, no-pack `24/27`, absolute lift `11.11` points versus required `20`, exact McNemar p `0.25`; no-regression and cost gates passed but the effect gate failed.
- Program decision: **NO-GO — preserve as verified memory/retrieval toolkit**. No default integration, broad OS claim, or outcome-driven rerun is allowed.
- Artifact return: tarball checksum passed and the control plane verified `950/950` manifest files with zero mismatches.

Additional honest evidence:

- The initial 30-item baseline scored `30/30`; the loop stopped rather than fabricating a mistake: `artifacts/math-foundations-smoke-20260725-052255174Z`.
- The corrected reliability challenge scored `20/20`; it also stopped without fabricating a mistake: `artifacts/math-foundations-smoke-20260725-052716583Z`.
- An earlier reliability-challenge run was invalid because the generated derangement oracle incorrectly expected `0`. Cortex's answers `D_10=1334961` and `D_6=265` were correct. That root is preserved only as verifier-regression evidence under `artifacts/_quarantine/false-derangement-oracle-20260725-052532795Z/` and produced no candidate/default promotion.

## Active blockers / unproven surfaces

- The completed bounded production slice remains green.
- The randomized A/B executed successfully, but its preregistered evidence threshold did not pass: both arms scored `26/27`, lift was `0`, and exact McNemar p was `1.0`.
- Broad or durable math improvement remains unproven.
- Retrieval-pack benefit and harm remain unproven under the declared exact-multiplication/model/runtime configuration.
- The capped mechanism track proved bounded retrieval transfer for seeded novel information, but the private-workspace utility track failed its preregistered effect threshold (`+11.11` points, p `0.25`).
- Ordinary Cortex task routing remains unchanged; the no-go result explicitly blocks default CLOS retrieval integration.
- Model weights were not changed.

## Next actions

1. Preserve the artifact-backed no-go result; do not outcome-rerun or broaden the Learning OS program.
2. Retain the useful verifier-gated lesson, provenance, promotion, expiration, rollback, and bounded-retrieval components as a memory/retrieval toolkit.
3. Keep ordinary-task/default routing unchanged. Any future narrowly scoped retrieval use requires separate evidence and explicit approval.

## Do not use / superseded

- Do not treat AI OS, SLOS, or Cortex/Codex consolidation as this project; they are related assets, not the CLOS implementation path.
- Do not use the quarantined false-derangement run as learning or capability evidence.
- Do not treat deterministic expected-answer fixtures as model capability evidence.

## Truth boundary

Allowed claims:

- Cortex Learning OS has a working, artifact-backed production slice.
- One bounded exact-arithmetic failure was followed by passed correction, independent promotion retest, and a different held-out retest after a gated retrieval pack.
- One scoped lesson passed the declared promotion gates and is available on the canonical capsule path.
- In the capped go/no-go, seeded synthetic-procedure retrieval transferred perfectly across fresh sessions under the declared runtime.
- The private-utility pack improved three of 27 paired items with no regressions, but this did not meet the preregistered utility effect threshold.

Not allowed:

- Cortex broadly learned mathematics.
- The retrieval pack alone caused the held-out pass.
- The improvement is durable across sessions or time.
- Cortex is an expert mathematician, quant PM, or profitable trader.
- Model weights changed.
- Live trading or external financial actions are approved.
