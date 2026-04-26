---
name: clawd-personal-ops-routing
description: Cortex-first local skill for routing personal assistant tasks across chat, Google Workspace, Home Assistant, and other connected systems. Use for deciding where a task belongs, batching low-friction checks, and keeping external actions deliberate instead of noisy.
---

# clawd-personal-ops-routing

Use this skill when the question is: what system should handle this, and should we act now or just report?

## Use this skill for

- deciding whether a task belongs in chat, Google Workspace, Home Assistant, or another connected system
- batching routine checks
- avoiding noisy or unnecessary external actions
- keeping assistant behavior helpful without becoming spammy

## Routing defaults

- chat only: summaries, advice, status, planning, non-actionable info
- Google Workspace: email, calendar, docs, drive tasks
- Home Assistant: environment or device state and actions
- other systems: only when they are clearly the system of record for the request

## Workflow

1. Classify the task.
   - info only
   - internal workspace action
   - external system read
   - external system write

2. Pick the smallest sufficient surface.
   - prefer a simple answer over an external action if that solves it
   - prefer a read before a write

3. Respect approval boundaries.
   - if the action leaves the machine in a meaningful way, ask first unless already clearly requested

4. Batch when possible.
   - combine inbox/calendar/weather style checks when useful
   - avoid interrupting with low-value noise

## Guardrails

- Do not send emails, posts, or messages without clear approval.
- Do not turn lightweight acknowledgments into workflow sprawl.
- Prefer one clean response over many fragmented notifications.
- Keep Cortex-first routing in mind before reaching for extra connectors.

## Output shape

Use this order:
1. Best surface
2. Why
3. Whether approval is needed
4. Next action
