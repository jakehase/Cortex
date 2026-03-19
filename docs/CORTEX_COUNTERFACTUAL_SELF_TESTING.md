Counterfactual pre-action self-testing

What it means
- before a major capability is relied on, Cortex checks whether that capability is likely usable right now
- this is not just static config; it is based on the current self-model and recent observations

Current implementation
- `scripts/cortex-capability-probe.mjs` refreshes the observed self-model
- `plugins/cortex-route-gate/index.ts` reads that self-model during prompt build
- route-gate injects a `CORTEX_SELF_MODEL` block into system context
- route-gate emits predicted pre-action checks for relevant capabilities such as:
  - `l2_browser_bridge`
  - `memory_write_through`

Why it matters
- reduces false confidence
- makes fallback behavior explicit before public failure
- lets Cortex reason with operational reality instead of stale assumptions
