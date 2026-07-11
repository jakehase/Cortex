# Agent Work v1 Operator Guide

Agent Work v1 is the canonical private/internal interface for compiling, executing, supervising, verifying, and reporting long-running repository work. Its release fidelity is `production_slice`; heavy execution remains remote-only.

## Supported interface

The product CLI is `agent-work`, backed by `apps/agent-work/cli.mjs` and `packages/canonical-agent-work`.

```bash
npm run agent-work:doctor -- --json
npm run agent-work:plan -- handoff.json --out artifacts/my-run
BENCHMARK_HOST_ROLE=execution_plane npm run agent-work:run -- artifacts/my-run
npm run agent-work:status -- artifacts/my-run --json
npm run agent-work:verify -- artifacts/my-run
npm run agent-work:report -- artifacts/my-run --format json
```

Other supported commands are `resume`, `cancel`, and `replay`. Stable exit codes are `0` success, `1` blocked, `2` invalid/denied, `3` infrastructure failure, and `4` cancelled.

## Operating boundary

1. Compile and inspect contracts on the control plane.
2. Run heavy campaigns only on a declared execution plane.
3. Treat `surface_matrix.json`, verifier evidence, and completion packets as truth; chat summaries are not authority.
4. Continue persistent campaigns until the supervisor is green or a specific blocker report is written.
5. Do not infer physical concurrency from requested or logical worker count.
6. Keep external actions denied unless separately approved.

## Recovery and handoff

Use `status`, then `resume` for nonterminal interruption. Use `verify` and `report` after execution. Consult `PHASE7_OPERATIONS_RUNBOOK.md` for restart, lease, disk, provider, and partial-state procedures. Consult `MIGRATION_AND_ROLLBACK.md` before invoking a legacy path.

## Release truth

The v1 release packet authorizes only the exact claim recorded in `packages/agent-work-release/index.mjs`. It does not authorize public GA, production deployment, full-clone parity, or worker-concurrency claims beyond observed evidence.
