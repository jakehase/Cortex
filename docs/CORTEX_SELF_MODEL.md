Cortex dynamic self-model

Purpose
- move from static capability claims to observed capability state
- distinguish:
  - claimed capability
  - implemented capability
  - live capability
  - verified capability
  - confidence to rely on capability right now

Files
- `state/cortex-self-model.json`
- `state/cortex-contradictions.json`
- `scripts/cortex-capability-probe.mjs`

What it adds
- live capability probes
- contradiction ledger
- confidence per capability
- degraded-capability list
- recommendations for reasoning/fallback behavior

Strong version
- use the self-model before action
- if a capability is degraded, route-gate should lower confidence and tell the model not to rely on that path without fallback

Usage
- refresh the self-model:
  - `node scripts/cortex-capability-probe.mjs`
- inspect contradictions:
  - `cat state/cortex-contradictions.json`
- inspect current operational self-model:
  - `cat state/cortex-self-model.json`
