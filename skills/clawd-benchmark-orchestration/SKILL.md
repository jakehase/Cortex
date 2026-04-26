---
name: clawd-benchmark-orchestration
description: Cortex-first local skill for authoring, running, rerunning, and honestly reporting orchestration benchmarks in this workspace. Use for benchmark contracts, surface matrices, threshold evaluation, artifact-root inspection, benchmark status checks, and transfer benchmark setup or reruns across Mailchimp, PMHNP, and the shared stack.
---

# clawd-benchmark-orchestration

This skill is a local operating overlay.

Cortex stays primary for reasoning, memory, browsing, routing, and user-facing answers.
Use this skill to add workspace-specific benchmark procedure, artifact discipline, and reporting guardrails.

## Use this skill for

- creating or refining a benchmark run contract
- building or checking a surface matrix
- running a transfer benchmark or orchestrator benchmark
- rerunning after a fix
- answering benchmark status questions from artifacts
- turning raw run output into an honest pass/blocker summary

## Do not use this skill for

- general incident forensics when the request is mainly "what broke" with no benchmark authoring or rerun work, use `clawd-benchmark-incident-audit` once it exists
- replacing Cortex browser, memory, or search paths
- claiming feature parity from benchmark scaffolding alone

## Workflow

1. Resolve the anchor.
   - Identify the exact benchmark, repo, artifact root, or run id.
   - If the user replied to a prior benchmark thread, treat that as the primary anchor.

2. Resolve the benchmark shape.
   - Repo path
   - Fidelity
   - Benchmark tier
   - Scope surfaces
   - Requested agent count
   - Stop condition
   - Execution boundary

3. Read canonical artifacts, not chat summaries.
   - For a finished run, start with:
     - `completion_summary.json`
     - `threshold_evaluation.json`
     - `blocker_report.json` if present
     - `orchestrator_run/summary.json`
   - If truth looks suspicious, also inspect:
     - `orchestrator_run/supervisor.json`
     - `orchestrator_run/worker_events.json`
     - `orchestrator_run/patch_queue.json`
     - `truth_conflicts.json`

4. Separate the truth layers.
   - `baselineReady` is not a scored orchestration pass.
   - `mechanicalGreen` is not a threshold pass.
   - `scaleProofReady` is not a threshold pass.
   - `thresholdPass` is the scored benchmark outcome.
   - Product parity/full clone claims require separate evidence beyond benchmark wiring.

5. When authoring or rerunning, enforce the contract.
   - Benchmark tier must match the declared thresholds.
   - Surface count and overlap must support the requested agent count honestly.
   - Duration target must be achievable for the wave shape, not just the first wave.
   - Stop condition should usually remain `supervisor_green_or_blocker_report`.

6. Report plainly.
   - State observed facts first.
   - State blocker family second.
   - State next action third.
   - If a run is red, do not bury it behind a "promising" summary.

## Required guardrails

- Never call a run passed unless `thresholdPass` is true.
- Never collapse `mechanicalGreen` into completion.
- Never count docs/tests/scripts-only changes as product implementation.
- Never give vibe-based completion percentages.
- If execution boundary rules are violated, stop and report that blocker.
- If artifact truth and chat claims diverge, trust the artifact root.

## Workspace-specific anchors

Read these when relevant:
- Benchmark spec: `/root/clawd/docs/AGENT_ORCHESTRATION_BENCHMARK_SPEC_2026-04-15.md`
- Stack inventory: `/root/clawd/docs/assistant-stack-inventory.md`
- Shared benchmark helpers usually live in:
  - `/root/clawd/large-project-capability-stack/apps/system-benchmark/`
  - `/root/clawd/large-project-capability-stack/packages/system-benchmark/`
  - `/root/clawd/large-project-capability-stack/packages/multi-agent-orchestrator/`

## References

- For artifact read order, truth distinctions, and common file meanings, read `references/benchmark-artifacts.md`.
- For common command patterns in this workspace, read `references/benchmark-commands.md`.

## Output shape

Prefer short benchmark updates in this order:
1. Status
2. Observed evidence
3. Root cause or blocker
4. Next action

When implementing or rerunning, include:
- benchmark id
- run id
- artifact root
- whether the run was baseline-ready, mechanically green, scale-proven, and threshold-pass

Keep it crisp. The value of this skill is disciplined benchmark truth, not verbosity.
