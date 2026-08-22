# Agent Work v1 Migration and Rollback

## Migration from pre-v1 and Synthetic Labor OS paths

1. Preserve the old run root; do not rewrite its evidence.
2. Run `npm run agent-work:doctor -- --json`.
3. Convert the old handoff or Cortex packet with `npm run agent-work:plan -- <input> --out <new-run-root>`.
4. Inspect the compiled contract, execution boundary, target path, fidelity, stop condition, and surface matrix.
5. Run on the execution plane with `BENCHMARK_HOST_ROLE=execution_plane npm run agent-work:run -- <new-run-root>`.
6. Verify and report through the canonical CLI.

The former `apps/system-benchmark/canonical-agent-work.mjs` path remains a warning-emitting wrapper. `apps/synthetic-labor-os/*` and `packages/synthetic-labor-os` are compatibility/evidence-only; do not route new work there.

## Rollback

Rollback is operational fallback, not a transfer of canonical authority.

1. Pause or cancel the v1 run and preserve its artifacts.
2. Record the v1 blocker and the reason rollback is needed.
3. Set a bounded rollback window and invoke the compatibility wrapper only for an existing compatible contract:
   `AGENT_WORK_SUPPRESS_COMPAT_WARNING=1 node apps/system-benchmark/canonical-agent-work.mjs status <run-root>`.
4. Do not start new heavy campaigns through Synthetic Labor OS.
5. Return to the v1 CLI after the blocker is fixed, then replay/verify before resuming.

## Rehearsal acceptance

Migration is green when new CLI `plan`, `status`, `verify`, and `report` match stable JSON/exit-code contracts. Rollback is green when the compatibility wrapper reaches the same facade, emits a warning by default, and does not target a second runtime. The Phase 9 test suite exercises both routes.
