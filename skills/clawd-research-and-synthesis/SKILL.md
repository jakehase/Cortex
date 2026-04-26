---
name: clawd-research-and-synthesis
description: Cortex-first local skill for researching current or unfamiliar topics and turning the result into a clean answer. Use when a task needs source gathering, source comparison, current-state checking, uncertainty handling, or concise synthesis across web evidence, workspace artifacts, and memory.
---

# clawd-research-and-synthesis

Use this skill when the work is not just finding facts, but turning evidence into a grounded answer.

Cortex remains primary for browsing, memory, and reasoning.
This skill adds a reusable synthesis discipline so answers stay evidence-backed and concise.

## Workflow

1. Define the question precisely.
   - What needs to be known?
   - What counts as current or volatile?
   - What kind of uncertainty would matter?

2. Gather the right evidence.
   - Use current-state sources for live facts.
   - Use workspace artifacts for repo or project truth.
   - Use memory for durable context, preferences, or past decisions.

3. Separate evidence from inference.
   - observed facts
   - likely interpretation
   - open uncertainty

4. Compress without flattening truth.
   - answer directly
   - include only the evidence that changes the decision
   - avoid chain-of-thought style dumping

5. End with the useful thing.
   - recommendation
   - tradeoff
   - next action
   - explicit uncertainty if it matters

## Guardrails

- Do not present memory as live telemetry.
- Do not present inference as observation.
- Do not overquote sources when a short synthesis is enough.
- Do not inflate confidence just because multiple weak sources agree.

## References

- Read `references/evidence-rules.md` when the question mixes web facts, workspace artifacts, and memory.

## Output shape

Use this order:
1. direct answer
2. observed evidence
3. recommendation or takeaway
4. uncertainty, if material
