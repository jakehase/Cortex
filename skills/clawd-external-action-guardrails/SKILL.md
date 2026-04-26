---
name: clawd-external-action-guardrails
description: Cortex-first local skill for deciding whether and how to act on external systems safely. Use when a task could send, post, message, email, schedule, or otherwise make a user-visible external change, and when approval boundaries, draft-vs-send distinctions, or system-of-record choices need to stay explicit.
---

# clawd-external-action-guardrails

Use this skill when a task might leave the machine or change an external system in a meaningful way.

Cortex remains primary for judgment.
This skill adds a reusable safety and clarity layer so outbound actions stay deliberate.

## Workflow

1. Identify the action class.
   - external read
   - external write
   - draft only
   - publish/send

2. Identify the system of record.
   - email
   - chat platform
   - calendar
   - document system
   - smart home
   - social/posting surface

3. Check approval status.
   - already explicitly requested
   - implied but not explicit
   - not approved

4. Pick the safe mode.
   - answer only
   - prepare draft
   - ask for approval
   - execute

5. Preserve action truth.
   - say whether it was drafted or sent
   - say what system was changed
   - keep the exact error if a write failed

## Guardrails

- Do not send or post on the user’s behalf without clear approval.
- Do not blur draft preparation into execution.
- Do not hide the system being touched.
- Do not ask for approval repeatedly when the user already explicitly asked for that exact action.
- Do not expand access or disable safeguards to make a tool work.

## References

- Read `references/approval-boundaries.md` when you need a quick approval check for a mixed task.

## Output shape

Use this order:
1. action type
2. approval state
3. chosen mode
4. next action or confirmation
