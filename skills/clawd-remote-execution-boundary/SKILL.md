---
name: clawd-remote-execution-boundary
description: Cortex-first local skill for deciding, enforcing, and verifying control-plane versus execution-plane boundaries. Use for heavy benchmark launches, remote sync checks, notifier/supervisor placement, remote worker proof, and blocker writing when a task should not run locally.
---

# clawd-remote-execution-boundary

Use this skill when the main question is not "how do we code it" but "where should this run and what evidence do we need before launch?"

Cortex stays primary. This skill adds boundary discipline.

## Use this skill for

- deciding whether a task must leave the control plane
- prelaunch checks for heavy worker farms
- remote sync validation
- supervisor/notifier split decisions
- stopping a risky local run and writing a structured blocker

## Default rule

Heavy execution belongs on an execution plane.
The OpenClaw chat host should usually remain the control plane.

## Treat as execution-plane work when the task includes

- heavy multi-agent execution
- browser-heavy validation
- repo-scale qualification
- long benchmark runs with many workers
- large test farms or high wall-clock resource use

## Workflow

1. Classify the task.
   - light control-plane work
   - mixed work
   - heavy execution-plane work

2. If heavy, require a remote boundary.
   - launcher path
   - sync path
   - remote workspace proof
   - supervisor/notifier placement
   - artifact return path

3. Refuse unsafe local launch.
   - If the boundary is missing, stop.
   - Write a blocker instead of silently running locally.

4. Verify remote integrity.
   - the right files are synced
   - the remote runtime is using the new code
   - artifacts come back from the real remote run, not a stale local shadow

## Guardrails

- Do not run heavy work locally just because the workspace lives here.
- Do not accept a remote run without sync proof when shared stack code changed.
- Do not let the worker decide alone that the job is complete.
- Keep notifier delivery lightweight enough to survive worker failure.

## References

- Read `references/boundary-checklist.md` for the prelaunch and postlaunch checklist.

## Output shape

Use this order:
1. Boundary classification
2. Observed evidence
3. Blocker or launch readiness
4. Next action
