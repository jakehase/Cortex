---
name: clawd-task-intake-routing
description: Cortex-first local skill for routing incoming requests to the right action shape. Use when a request is vague, overloaded, or could branch between chat-only advice, internal workspace work, external reads, external writes, research, coding, or wait-state handling. Helps classify scope, pick the smallest sufficient action, and avoid unnecessary tool or connector use.
---

# clawd-task-intake-routing

Use this skill to decide what kind of task is actually being asked for before acting.

Cortex remains primary for reasoning and routing.
This skill adds a reusable local intake procedure so requests do not sprawl into the wrong tools, wrong repo, or wrong action surface.

## Workflow

1. Bind the anchor.
   - What exact message, reply thread, artifact, or repo is the task pointing at?

2. Classify the task.
   - chat-only answer
   - internal workspace read/edit/exec work
   - external system read
   - external system write
   - research task
   - long-run task
   - memory/update task

3. Pick the smallest sufficient action.
   - Prefer a direct answer when no tool is needed.
   - Prefer internal tools before external connectors.
   - Prefer reads before writes.
   - Prefer one decisive action over exploratory sprawl.

4. Check for blockers.
   - missing anchor
   - missing repo/path
   - missing approval for external action
   - heavy execution that should not run locally

5. Route cleanly.
   - If the task clearly belongs to a more specific local skill, use that workflow.
   - If it is general, keep the response/tooling minimal.

## Guardrails

- Do not treat every request like a coding task.
- Do not reach for external systems when chat or local workspace action is enough.
- Do not ask for clarification if the anchor is clear enough to act safely.
- Do not create a plan-shaped reply when the next tool step is obvious.

## References

- Read `references/decision-tree.md` when the task could plausibly branch into multiple action surfaces.

## Output shape

Use this order when routing matters:
1. task type
2. chosen surface
3. blocker or approval need, if any
4. next action
