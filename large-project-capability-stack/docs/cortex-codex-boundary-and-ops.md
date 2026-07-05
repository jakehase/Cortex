# Cortex / Codex Boundary and Ops Cleanup

This document is intentionally **non-behavior-changing**. It records labels, checks, and cleanup rules so the current Cortex activation path stays intact.

## Boundary rule

- **Cortex** is the control-plane/context/routing/memory/truth-supervision layer.
- **Codex** is the execution-plane CLI/model worker used for bounded product edits.
- A worker may be described as **Cortex-context-governed** only when a Cortex context packet/context governor is actually supplied to that worker.
- A run may be described as **real Codex/model work** only when provider/runtime/ledger evidence exists.
- Chat/control-plane Cortex activation does not by itself make remote workers “Cortex agents.”

## What must not be weakened

Keep these mandatory for creative/large worker launches:

- `CREATIVE_WORKER_CORTEX_REQUIRED=true` for Cortex-governed creative workers.
- `CREATIVE_WORKER_BUDGET_REQUIRED=true` and a shared budget ledger.
- bounded per-worker Codex calls.
- bounded global Codex calls.
- active Codex-call semaphore/schedule.
- token/message budget telemetry and provider-limit detection.
- canary ladder before materially larger spend.

## Non-invasive health dashboard

Run:

```bash
npm --silent run ops:cortex:health -- --artifact-root <optional-artifact-root>
# or, for guaranteed raw JSON:
node apps/system-benchmark/cortex-ops-health-dashboard.mjs --artifact-root <optional-artifact-root>
```

The dashboard only reads local endpoints/files. It does **not** modify Cortex routing, memory, prompts, workers, or benchmark thresholds.

It reports:

- Cortex `/health` status.
- Cortex runtime process count/status summary.
- route-gate file freshness.
- optional latest creative-worker budget ledger state.
- inferred Cortex/Codex cognition boundary.

## Quarantine policy

Prefer recoverable moves over deletion.

Do not quarantine:

- active run roots.
- proof seals.
- canonical terminal benchmark evidence that is still cited in status/memory.
- current product briefs or current launch roots.

Safe cleanup candidates:

- old one-off canary roots.
- scratch logs/PIDs with no running process and no canonical status role.
- failed staging roots already superseded by later clean roots.

Every quarantine move needs a manifest with original path, new path, reason, and recovery instructions.
