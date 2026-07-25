# Cortex Learning OS Status

## Metadata

- Project slug: `cortex-learning-os`
- Canonical plan: `/root/clawd/cortex-learning-os/plan.md`
- Decisions log: `/root/clawd/cortex-learning-os/DECISIONS.md`
- Last updated: `2026-07-25 00:42 CDT`
- Status: `active`
- Current fidelity: `production_slice`
- Package version: `0.2.0`

## Current checkpoint

Cortex Learning OS has completed its first bounded, verifier-gated learning loop for the math-foundations capsule. The implementation is integrated into the authoritative remote `main`; the verified implementation commit is `b03add355` and its first lifecycle/documentation integration commit is `944808d72`. The feature branch `feat/cortex-learning-os-v0-20260725` is preserved at that integration point.

The production slice now includes:

- 14 machine tests covering contracts, deterministic checkers, fail-closed promotion, retrieval limits, curriculum coverage, and learning-loop behavior.
- 14 JSON record schemas plus internal contract validation.
- A 36-concept math-foundations curriculum.
- A 30-item deterministic baseline exam, a 20-item exactness/reliability challenge, and a 20-item exact-arithmetic stress exam.
- Recorded no-tool OpenClaw/Cortex answer capture with provider/model/usage provenance.
- Attempt records, verifier results, mistake records, candidate lessons, promotion reports, trusted lessons, retrieval packs, capability reports, and hashed manifests.
- Canonical default capsule files under `capsules/math-foundations/`.

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

Additional honest evidence:

- The initial 30-item baseline scored `30/30`; the loop stopped rather than fabricating a mistake: `artifacts/math-foundations-smoke-20260725-052255174Z`.
- The corrected reliability challenge scored `20/20`; it also stopped without fabricating a mistake: `artifacts/math-foundations-smoke-20260725-052716583Z`.
- An earlier reliability-challenge run was invalid because the generated derangement oracle incorrectly expected `0`. Cortex's answers `D_10=1334961` and `D_6=265` were correct. That root is preserved only as verifier-regression evidence under `artifacts/_quarantine/false-derangement-oracle-20260725-052532795Z/` and produced no candidate/default promotion.

## Active blockers / unproven surfaces

- No blocker for the bounded production slice.
- Broad or durable math improvement is unproven.
- Retrieval-pack causality is unproven because the baseline was a 20-item batch while correction/retest phases were single-item and easier.
- Ordinary Cortex task routing does not yet auto-select a Learning OS capsule outside the explicit CLOS run path.
- Model weights were not changed.

## Next actions

1. Run equal-difficulty, randomized A/B retests across fresh isolated sessions: trusted retrieval pack versus no pack.
2. Require repeated out-of-sample passes over time before raising any durability claim.
3. Only after that evidence, add capsule selection/retrieval as a bounded default Cortex pre-task hook with rollback and token limits.

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
