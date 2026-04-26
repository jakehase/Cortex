---
name: clawd-brownfield-transfer-benchmark
description: Cortex-first local skill for selecting, shaping, and running brownfield transfer benchmarks in this workspace. Use for transfer repo selection, low-overlap surface design, baseline versus orchestrator verification choices, agent-count honesty, and benchmark setup on non-Mailchimp repos like PMHNP.
---

# clawd-brownfield-transfer-benchmark

Use this skill to adapt the benchmark program to a non-Mailchimp repo without faking scale or overclaiming transfer success.

## Use this skill for

- choosing a transfer benchmark repo
- building a low-overlap surface matrix
- deciding between baseline readiness and orchestrator benchmark paths
- setting honest requested agent counts
- shaping a rerunnable transfer preset

## Selection rubric

Prefer repos that have:
- real inspectable behavior or tests
- mixed surface types where possible
- enough independently verifiable work to support the requested concurrency
- topology unlike Mailchimp so transfer is meaningful

## Workflow

1. Pick the repo and say why.
2. Inventory candidate surfaces.
3. Remove overlapping surfaces that would fake parallelism.
4. Decide whether the first pass is:
   - baseline-ready only
   - full orchestrator benchmark
5. Make sure the requested agent count is supported by real low-overlap surfaces.
6. Set a duration target the surface wave shape can actually sustain.

## Guardrails

- Do not claim transfer success from a repo that only supports a tiny surface count against a big agent claim.
- Do not turn module-load smoke into deep product parity language.
- Do not reuse Mailchimp-specific structure if the target repo shape does not support it.
- Prefer honest lower-scale proof over inflated concurrency claims.

## Output shape

Use this order:
1. Selected repo
2. Why it fits transfer benchmarking
3. Surface shape
4. Baseline or orchestrator path
5. Honest scale claim
6. Next action
