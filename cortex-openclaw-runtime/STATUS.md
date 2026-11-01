# Cortex-Native OpenClaw Runtime Status

Updated: 2026-11-01 CDT
Status: active
Current milestone: Phase 2, qualified release packaging and activation
Fidelity: production slice
Stop condition: focused end-to-end smoke green or blocker report

## Reply anchor

Jake approved the immediately preceding recommendation: make Cortex the native cognitive and agent-loop layer inside OpenClaw, while retaining OpenClaw as the hardened channel, session, tool, approval, scheduling, and delivery runtime. Keep Cortex outside OpenClaw core so upgrades change only a thin compatibility adapter.

## Grounding proof

- Target implementation: `/root/clawd/worktrees/cortex-openclaw-runtime-20261101/plugins/cortex-route-gate`
- Exact implementation baseline: live release commit `1de5218d2807f577b5dd1ec3a8d92985d084347b`; source and live route-gate hashes matched before editing.
- Lifecycle project path: `/root/clawd/cortex-openclaw-runtime`
- Live OpenClaw: `2026.7.1-2 (0790d9f)`
- Live Cortex plugin release at grounding: `/opt/cortex/releases/cortex-daily-work-core-1de5218d2807-20261029`
- Prior-art decision: extend existing Cortex plugins; do not create a standalone harness.
- Prior-art artifact: `/tmp/cortex-harness-prior-art.json`
- OpenClaw core changes allowed: none

## Observed current state

- The live `cortex-route-gate` already handles prompt construction, compaction, tool-call observation, persisted tool-result projection, model output, delivery interception, and agent-end lifecycle.
- The root workspace plugin copy is not the configured live source and was rejected as an implementation base. The first adapter draft against that stale path was quarantined under `/root/clawd/_quarantine/cortex-openclaw-runtime-stale-root-20261101`; its index refactor was reversed exactly.
- OpenClaw's public Agent Harness SDK exists but third-party harness installation is experimental.
- The public SDK does not expose safe harness-to-harness chaining. Duplicating the existing OpenClaw or Codex executor would violate the prior-art gate.
- Therefore the current slice isolates the existing Cortex lifecycle behind a versioned compatibility adapter instead of introducing another model executor.

## Completed in Phase 1

- Added `cortex.openclaw.compat.v1`, tested against OpenClaw `2026.7.1-2 (0790d9f)`.
- Routed all 12 existing Cortex lifecycle hooks through the adapter without changing their cognitive behavior.
- Bumped the route-gate plugin version from `0.2.0` to `0.3.0`.
- Ran exactly one focused lifecycle smoke. It passed prompt routing, evidence-gated finalization, tool observation, tool-result projection, output observation, delivery preservation, and agent-end in-flight cleanup.
- Smoke receipt: `/root/clawd/cortex-openclaw-runtime/artifacts/native-runtime-smoke.json`.

## Current work

1. Commit the exact-live implementation slice.
2. Build a versioned release from the currently configured live release plus the qualified plugin delta.
3. Update the configured Cortex plugin load path without changing secrets or plugin policy.
4. Reload OpenClaw once and inspect plugin selection directly.

## Blockers

None currently.

## Truth boundary

This project is not yet a claim that Cortex replaces OpenClaw's low-level executor. The current production slice makes the already-live Cortex cognitive lifecycle native, versioned, and upgrade-isolated inside OpenClaw.
