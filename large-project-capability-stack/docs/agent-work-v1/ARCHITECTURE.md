# Agent Work v1 Architecture

## Canonical path

```text
OpenClaw -> Cortex -> Agent Work contract -> execution-plane workers -> independent verifier -> artifact-backed delivery
```

The supported CLI is `apps/agent-work/cli.mjs`. It enters `packages/canonical-agent-work`, which composes planning, execution, verifier, operations, release-candidate, and release packages. Benchmark controllers are implementation and qualification details behind the facade, not public product APIs.

## Authority

`config/agent-work-v1/authority-matrix.json` assigns one authority to each decision. Continuation and terminal truth share the canonical runtime/supervisor authority. Worker self-report cannot authorize merge, completion, or release. Independent verifier evidence and the machine-readable surface matrix decide which claims survive.

## Plan and execution split

The control plane performs contract compilation, admission, supervision, artifact consumption, and notification. Heavy worker farms, browser qualification, long soaks, and repository-scale tests execute off-host with `BENCHMARK_HOST_ROLE=execution_plane`. The runtime fails closed if a remote-required contract is started on the control plane.

## Durable state and truth

Run manifests, events, leases, patch admission, verifier packets, claim ledgers, and completion summaries are durable artifacts. Recovery reconstructs state from those records. Terminal truth requires the requested surface matrix to be complete; an exhausted finite graph with a red objective must expand or emit a specific blocker.

## Compatibility boundary

`apps/system-benchmark/canonical-agent-work.mjs` is a compatibility wrapper. Synthetic Labor OS packages and v19/v20 release scripts are compatibility and evidence surfaces. They receive no canonical routing, decision, or completion authority and must not be targeted by `agent-work:` package scripts.
