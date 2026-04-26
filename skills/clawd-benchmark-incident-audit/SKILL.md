---
name: clawd-benchmark-incident-audit
description: Cortex-first local skill for diagnosing failed orchestration benchmarks from canonical artifacts in this workspace. Use for run failures, fake-green suspicion, shard loss, lease churn, verifier failures, state loss, late-wave shutdowns, and blocker reports across Mailchimp, PMHNP, and the shared stack.
---

# clawd-benchmark-incident-audit

This skill is a local workflow overlay.
Cortex stays primary for reasoning, memory, browsing, routing, and user-facing answers.
Use this skill for disciplined benchmark failure forensics.

## Use this skill for

- "why did this run fail?"
- failed reruns after a benchmark patch
- suspicious green/amber/red transitions
- worker churn, stale leases, SIGKILL exits, missing merges
- turning raw artifacts into a clean blocker report

## First read order

Start with:
1. `completion_summary.json`
2. `threshold_evaluation.json`
3. `blocker_report.json` if present
4. `orchestrator_run/summary.json`

Then continue with:
- `orchestrator_run/supervisor.json`
- `orchestrator_run/worker_events.json`
- `orchestrator_run/patch_queue.json`
- `truth_conflicts.json`

## Audit workflow

1. Bind the exact run.
   - run id
   - artifact root
   - benchmark id
   - repo path if relevant

2. Classify the failure family from artifacts, not vibes.
   - threshold red after mechanical green
   - fake-green contradiction
   - stale lease churn
   - verifier failure
   - late-wave shutdown
   - continuity/state loss
   - scale shortfall
   - execution-boundary violation
   - planner/admission failure

3. Pull evidence before diagnosis.
   - counts from `completion_summary.json`
   - metric failures from `threshold_evaluation.json`
   - worker timeline from `worker_events.json`
   - shard states from `supervisor.json`
   - merged vs rejected evidence from `patch_queue.json`

4. Separate observed facts from inference.
   - observed: artifact fields, timestamps, exit codes, counts, listed failures
   - inference: likely root cause, repair direction, confidence level

5. End with a repair-oriented blocker.
   - blocker
   - evidence
   - next action
   - rerun gate

## Guardrails

- Never call a failure a flake without artifact evidence.
- Never say a surface failed if the failure was orchestrator-only unless artifacts prove the surface failed.
- Never treat chat summaries as more authoritative than the artifact root.
- If truth is contradictory, say so plainly and cite the contradictory artifacts.
- If uncertainty remains, state it once and move on.

## References

- Read `references/failure-families.md` for common benchmark failure families and what to inspect first.
- Read `/root/clawd/skills/clawd-benchmark-orchestration/references/benchmark-artifacts.md` for artifact meanings and truth layers.

## Output shape

Use this order:
1. Status
2. Observed evidence
3. Root cause
4. Next action
5. What remains uncertain

Keep it crisp and evidence-backed.
