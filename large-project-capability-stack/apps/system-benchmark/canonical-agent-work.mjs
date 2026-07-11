#!/usr/bin/env node
// Compatibility entrypoint only. The supported product CLI lives at apps/agent-work/cli.mjs.
if (process.env.AGENT_WORK_SUPPRESS_COMPAT_WARNING !== '1') {
  console.error('[compatibility-warning] apps/system-benchmark/canonical-agent-work.mjs is compatibility-only; use `agent-work` or apps/agent-work/cli.mjs.');
}
await import('../agent-work/cli.mjs');
