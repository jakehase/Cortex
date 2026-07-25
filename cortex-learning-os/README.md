# Cortex Learning OS

Cortex Learning OS is a local, verifier-gated learning layer for Cortex/OpenClaw. It stores curricula, recorded attempts, deterministic verifier results, mistakes, candidate lessons, promoted trusted lessons, retrieval packs, and bounded capability reports. It does not modify model weights.

## Current production slice

The canonical starter capsule is `capsules/math-foundations/`:

- 36-node math-foundations curriculum
- 30-item deterministic baseline exam
- exactness/reliability challenge exams
- no-tool OpenClaw model attempt capture
- deterministic answer checkers
- mistake ledger and lesson candidate generation
- fail-closed promotion requiring independent correction and retest evidence
- token-bounded retrieval pack generation
- canonical trusted lesson and capability report paths

The latest qualified run pointer is `artifacts/latest-qualified-run.json`.

## Commands

```bash
npm test
npm run validate:fixtures
npm run exam:fixture
npm run dogfood:math
npm run dogfood:challenge
npm run dogfood:stress
npm run experiment:ab:plan -- --experiment-id <id> --seed <seed>
npm run experiment:ab -- --experiment-id <id> --seed <seed>
```

`dogfood:*` uses isolated, non-delivering `openclaw agent` sessions. A run writes immutable evidence under `artifacts/<run-id>/`. With `--promote-default`, canonical capsule files change only after every promotion gate and the held-out retest pass.

`experiment:ab` preregisters and runs a randomized paired comparison of the promoted retrieval treatment against no retrieval context. The default plan has 27 identical-item pairs / 54 fresh ephemeral Codex sessions, three pairs above the 24-valid-pair minimum; the separate ≤10% invalid-rate gate permits at most two invalid pairs. It uses deterministic grading, no allowed tools, fixed exact-McNemar analysis, and no outcome-driven reruns. Use `--plan-only` to inspect and freeze the full schedule before model calls; use `--resume` only to continue missing trials without rerunning any completed or invalid trial.

## Canonical default paths

```text
capsules/math-foundations/capsule.json
capsules/math-foundations/trusted_lessons.json
capsules/math-foundations/latest_retrieval_pack.json
capsules/math-foundations/capability_report.json
artifacts/latest-qualified-run.json
```

## Truth boundary

A green learning-loop run proves only that the declared bounded loop completed for the named evidence. A completed A/B run proves retrieval benefit only if all preregistered validity, lift, and exact-test gates pass; mechanical completion is reported separately. Neither result proves general mathematical expertise, durability over time, model-weight learning, or improvement outside the declared exact-multiplication/runtime configuration.
