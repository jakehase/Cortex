# Route-gate and governor evidence

This page gives public-safe evidence that route-gate / governor behavior is not just conceptual.

## Creativity governor evidence

Behavioral harness in the live workspace:
- `plugins/cortex-route-gate/creativity-governor.test.mjs`

Verified behaviors described by the test harness:
- novelty prompts inject the creativity governor
- ordinary prompts do not false-trigger creativity mode
- cron/runtime wrappers do not spuriously activate creativity mode
- internal Oracle bridge sessions bypass route injection
- recent anchors are quarantined on later strict-novelty prompts
- failed creativity audits can be suppressed before delivery
- failed creativity audits create stronger retry guidance

## Prompt-routing guard evidence

Documented implementation:
- `CORTEX_PROMPT_ROUTING_GUARD_2026-03-15.md`

Key claim:
- prompts entering Oracle should receive a level plan from Nexus first
- planned levels are merged into answer-generation metadata
- emergency bypass defaults off unless explicitly re-enabled

## Capability / epistemic guard evidence

Public docs:
- `CORTEX_CAPABILITY_GUARD_CONTROL_PLANE.md`
- `CORTEX_EPISTEMIC_GUARD_V1.md`

These describe concrete implementation-facing behavior such as:
- capability reality-check gate
- routing markers for capability checks
- routing markers for epistemic guard execution
- historical contradiction detection

## Smartness automation evidence

Public doc:
- `CORTEX_SMARTNESS_AUTOMATION_20260219.md`

Documented behaviors include:
- routing autotune loop
- automatic second-pass repair
- automatic L9 activation policy
- micro-retrieval reranking
- nightly intelligence checks
- Nexus autotune status endpoint

## Practical point

These are not merely labels for levels.
They represent actual routing/governor/control-plane behavior that has been implemented, tested, or audited in the live system.
