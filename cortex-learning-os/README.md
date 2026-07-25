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
```

`dogfood:*` uses isolated, non-delivering `openclaw agent` sessions. A run writes immutable evidence under `artifacts/<run-id>/`. With `--promote-default`, canonical capsule files change only after every promotion gate and the held-out retest pass.

## Canonical default paths

```text
capsules/math-foundations/capsule.json
capsules/math-foundations/trusted_lessons.json
capsules/math-foundations/latest_retrieval_pack.json
capsules/math-foundations/capability_report.json
artifacts/latest-qualified-run.json
```

## Truth boundary

A green run proves only that the declared bounded loop completed for the named evidence. It does not prove general mathematical expertise, durable transfer, model-weight learning, or that a retrieval pack alone caused the observed result. Baseline batch size and held-out item difficulty are recorded as comparison limitations.
