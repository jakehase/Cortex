# Agent Work Semantic Workforce Standard

## Default behavior

Agent count is optional. When the operator omits it, Agent Work uses `workforcePolicy.mode=semantic_auto` and derives the launch target from the admitted executable work graph.

An explicit operator count is a safety cap by default, not permission to fabricate parallelism. Agent Work still reduces the target when dependency-ready, low-overlap work is smaller.

Workspace defaults:

- minimum: `1`
- maximum: `12` (the currently qualified physical-worker tier)
- recompute: every objective-controller wave
- external writes: unchanged and separately governed

## Decision inputs

The allocator records and considers:

1. dependency-ready work;
2. file/path overlap and global write scopes;
3. objective fidelity and graph complexity;
4. executable verifier obligations;
5. operator, policy, provider, execution-plane, budget-concurrency, and worker-spawn caps;
6. prior-wave productive merge rate;
7. provider error rate;
8. merge and verifier backlog;
9. execution-plane resource pressure.

The target can never exceed the number of independent ready work items. Missing file ownership is treated conservatively as global overlap.

## Decision outputs

Each decision emits:

- `minAgentCount`
- `targetAgentCount`
- `maxAgentCount`
- selected and deferred work-item IDs
- constraint inputs
- adaptation reasons
- a stable decision digest

Planning writes:

- `semantic_workforce_plan.json` — launch sizing over admitted executable surfaces;
- `phase4_planning/decomposition_workforce_plan.json` — potential parallel capacity in planning/negative-space work, reported separately so it cannot inflate launch count.

The objective controller writes:

- `waves/wave-NNN/semantic_workforce_plan.json`;
- `semantic_workforce_history.json`;
- the selected count and digest into each wave contract and controller summary.

## Truth boundary

A workforce plan is scheduling evidence only. It does not prove that workers spawned, started, performed model calls, completed, merged productive patches, or reached the planned physical concurrency. Those claims still require worker events, provider ledgers, accepted-patch evidence, and verifier artifacts.

## Overrides

Operators may:

- omit agent count and accept semantic automatic sizing;
- set an explicit count as an upper bound;
- reduce `maxAgents` below the workspace default;
- supply provider/execution capacity in policy or host facts;
- disable per-wave telemetry adaptation with `adaptEachWave=false`.

Agent Work must not increase beyond hard operator, provider, execution-plane, or budget limits.
