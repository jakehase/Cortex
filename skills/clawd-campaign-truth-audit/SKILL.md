---
name: clawd-campaign-truth-audit
description: Cortex-first local skill for auditing truth layers in long-run campaigns and benchmarks. Use for mechanical-green vs threshold-pass separation, parity-ceiling vs orchestration truth, notifier honesty, completion claim audits, and contradiction checks across Mailchimp and shared control-plane work.
---

# clawd-campaign-truth-audit

This skill sharpens truth discipline. It does not replace Cortex.
Use it when the risk is overclaiming, collapsing truth layers, or reporting the wrong kind of green.

## Use this skill for

- auditing a completion claim
- separating orchestration success from requested-outcome success
- checking notifier/supervisor honesty
- fake-green reviews
- parity-for-scope vs full-clone truth checks

## Truth ladder

Keep these separate:
- transport/launcher health
- supervisor status
- mechanical green
- scale proof
- threshold pass
- parity status
- full-clone status
- blocker kind

A green value in one layer does not automatically propagate upward.

## Workflow

1. Anchor the claim.
   - What exact thing is being claimed?
   - benchmark pass?
   - orchestration health?
   - parity-for-scope?
   - full clone?

2. Read the canonical artifacts or project state.
   - `completion_summary.json`
   - `program_state.json`
   - `supervisor_status.json`
   - `notification_state` or notifier output if present
   - parity or matrix artifacts if the claim is parity-related

3. Identify contradictions.
   - green while blocker exists
   - completion claim with unfinished matrix
   - threshold-pass language when only mechanical green exists
   - feature-complete claim with only scaffolding touched

4. Restate the truth cleanly.
   - what passed
   - what did not pass
   - what is still blocked
   - which artifact proves each point

## Guardrails

- Never compress multiple truth layers into one word like "done" unless the top requested outcome is actually satisfied.
- Never let notifier convenience override canonical artifacts.
- Never treat scaffolding/control-plane work as product parity unless the diff proof supports it.
- If requested outcome is still blocked, say so even when orchestration internals are healthy.

## References

- Read `references/truth-layers.md` when you need wording discipline for layered outcomes.

## Output shape

Use this order:
1. What is true
2. What is not true
3. Contradictions, if any
4. Blocker
5. Next action
