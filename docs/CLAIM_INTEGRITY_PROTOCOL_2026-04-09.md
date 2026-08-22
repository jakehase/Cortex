# Claim Integrity Protocol — 2026-04-09

This protocol exists to stop unsupported progress and parity claims from drifting upward just because some code, tests, or orchestration exist.

## Why this exists

A project can have:
- good orchestration
- a handful of working routes
- passing tests in a limited slice
- convincing partial demos

and still be nowhere near the real target product.

So from now on, progress and parity claims should be grounded in a reusable claim-integrity system rather than intuition.

## Hard rules

1. No intuition-only percentages.
   - If there is no artifact-backed rubric, say `unknown`.
   - Do not answer with vibe-based percentages.

2. Separate execution from product parity.
   - `executionReadinessPercent` is not `cloneParityPercent`.
   - Strong orchestration does not imply strong product completion.

3. Use leaf surfaces, not broad buckets.
   - `campaigns = partial` is too coarse.
   - Progress should be computed from leaf workflows and subsurfaces.

4. Score depth, not existence.
   Each leaf is evaluated across dimensions such as:
   - product diffs
   - route/entrypoint existence
   - UI presence
   - workflow depth
   - persistence/state
   - edge-case coverage
   - realism proof
   - evidence lineage

5. Track negative space explicitly.
   - Missing leaves are first-class evidence.
   - Huge missing surface area must keep the estimate low.

6. Require evidence lineage.
   Every meaningful claim should trace to:
   - target reference
   - changed product files
   - proof artifacts
   - confidence
   - known missing adjacent surfaces

7. Run an adversarial audit.
   The system should explicitly ask:
   - Why might this estimate be too high?
   - What major surfaces are still missing?
   - What would need to be true for a materially higher estimate?

8. Use pessimistic aggregation.
   Do not let a few strong areas hide giant holes elsewhere.

## Implemented shared tooling

Reusable package:
- `large-project-capability-stack/packages/claim-integrity/index.mjs`

CLI entrypoint:
- `node large-project-capability-stack/apps/stack-cli.mjs claim-integrity compile <spec.json> <out.json>`

Test coverage:
- `large-project-capability-stack/tests/claim-integrity.test.mjs`

## Output contract for future answers

For serious progress/parity/truth questions, answers should be structured as:
- Observed
- Estimated
- Confidence
- What’s missing
- What would have to be true for a higher estimate

## What this is for

This is broad infrastructure, not a Mailchimp-only patch.

Use it for:
- clone/parity status
- roadmap completion status
- security hardening completion claims
- migration completeness
- long-run campaign honesty gates
- any question where optimistic estimates can cause bad decisions
