---
name: clawd-status-memory-handoff
description: Cortex-first local skill for turning completed work, ongoing work, and important context into durable status and memory updates. Use when finishing a task, handing off an in-progress thread, updating daily memory, writing project-state summaries, or separating current observed state from remembered context.
---

# clawd-status-memory-handoff

Use this skill when the work is done enough that future-you or the user will need a durable summary.

Cortex remains primary for judgment and memory routing.
This skill adds a repeatable local discipline for what to write down, where to write it, and how to avoid polluting memory with noise.

## Workflow

1. Decide whether the event is worth writing down.
   Good candidates:
   - completed meaningful work
   - important blocker
   - user preference or standing rule
   - project-state change
   - lesson that should survive the session

2. Choose the right destination.
   - daily notes: `memory/YYYY-MM-DD.md`
   - curated long-term: `MEMORY.md`
   - project canonical state: `memory/projects/<project>.md`
   - local operating specifics: `TOOLS.md`

3. Preserve truth level.
   - current observed state
   - last known checkpoint
   - inference or judgment

4. Keep the summary lean.
   - what changed
   - evidence or artifact path
   - blocker or next action
   - anything future-you must not forget

5. Avoid memory pollution.
   - do not dump raw logs unless they matter
   - do not store secrets unless clearly intended
   - do not write trivial chatter into durable memory

## Guardrails

- Do not call remembered state current unless live-verified.
- Do not let memory replace canonical artifacts for volatile facts.
- Do not skip writing down important decisions you will want later.
- Do not overfill MEMORY.md with ephemeral details.

## References

- Read `references/write-destinations.md` when choosing where a summary belongs.

## Output shape

When reporting a handoff or memory write, use this order:
1. what changed
2. where it was recorded
3. what remains
