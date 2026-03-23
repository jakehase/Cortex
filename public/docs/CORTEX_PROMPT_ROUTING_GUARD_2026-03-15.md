# Cortex prompt routing guard — 2026-03-15

## Intent
Make Cortex decide **which levels apply** before Oracle treats a prompt as answerable.

## Permanent policy
For every prompt entering `Oracle /chat`:
1. Run mandatory pre-routing through Cortex Nexus.
2. Produce a level plan (`recommended_levels`).
3. Attach those levels to activation metadata.
4. Only then proceed to answer-generation lanes.

## Implementation
- `oracle.py` now resolves a `level_plan` before answer generation.
- Default emergency bypass is changed to **off** unless explicitly re-enabled.
- Oracle responses merge `planned_levels` into `active_levels` so the turn reflects which levels were considered.
- Oracle status now exposes:
  - `require_level_routing`
  - `emergency_bypass_enabled`

## Limitation
This hardens **every prompt that reaches Cortex Oracle**.
If a prompt never enters Cortex at all, it cannot be semantically routed by Cortex. That requires upstream mediation/wiring to send prompts into Cortex first.

## Success condition
A prompt is not considered semantically valid unless a level plan exists first.
