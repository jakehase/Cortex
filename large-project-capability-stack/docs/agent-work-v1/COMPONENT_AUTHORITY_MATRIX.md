# Agent Work v1 component authority matrix

Machine-readable source: `config/agent-work-v1/authority-matrix.json`.

## Principle

Every consequential decision has exactly one authority. Other components may contribute evidence or execute the decision, but they may not independently override it. This prevents the current benchmark controller, autonomy helper, SLOS shell, and run-state reducer from each producing a different answer to “continue or stop?”

## Frozen v1 authority

| Decision | Sole authority | Important contributors | Current duplication to remove or demote |
|---|---|---|---|
| Objective grounding | Cortex | OpenClaw, Cortex adapter | DSL and FPE currently repeat portions of grounding validation. |
| Contract validation | `packages/canonical-agent-work` | DSL, Full Parity Engine | DSL and finite runner validate overlapping subsets. |
| Run admission | `packages/canonical-agent-work` | Cortex, future runtime | SLOS and finite runner have separate admission-like gates. |
| Inventory truth | `packages/full-parity-engine` | decomposer, structural memory, project adapters | Decomposer and benchmark catalogs expose competing surface truth. |
| Work graph compilation | `packages/full-parity-engine` | decomposer, scheduler | DSL, decomposer, and objective controller all produce work-like graphs. |
| Scheduling | `packages/multi-agent-orchestrator` | runtime, FPE | Finite and continuous runners contain scheduler policy. |
| Lease/fencing | future `packages/agent-work-runtime` | multi-agent orchestrator | Existing leases are runner-local rather than one durable authority. |
| Worker execution | future `packages/agent-work-worker-adapters` | Codex, runtime | Creative/live worker scripts are separate invocation paths. |
| Patch admission | `packages/multi-agent-orchestrator` merge lane | claim ledger, verifier | Runner code also makes admission decisions. |
| Independent verification | future `packages/agent-work-verifier` | project verifiers, FPE | Verification is embedded in benchmark/project scripts. |
| Continuation decision | `packages/orchestrator-run-state` | autonomy, FPE | Autonomy, objective controller, and persistent runners currently decide continuation. |
| Terminal truth | `packages/orchestrator-run-state` | FPE, claim ledger, verifier | Finite runner, objective controller, and SLOS write terminal truth independently. |
| Claim packet | `packages/canonical-agent-work` | claim ledger, FPE, verifier | Benchmark and SLOS completion summaries assemble competing claims. |
| Notification delivery | OpenClaw | runtime | Benchmark notifier/watcher scripts duplicate delivery behavior. |

## Enforcement sequence

1. **Phase 1:** freeze this matrix and test that all required decisions have one authority.
2. **Phase 2:** make the canonical facade the only supported product entrypoint.
3. **Phase 3:** move durable lease, continuation, and terminal decisions behind runtime/run-state APIs.
4. **Phase 4:** make FPE inventories/work graph authoritative.
5. **Phase 5:** isolate worker execution and patch admission behind adapters/services.
6. **Phase 6:** centralize independent verification and claim assembly.
7. **Phase 7:** centralize operational notification and recovery paths.

## Current contradictions that Phase 1 records rather than hides

- `run-agent-work-objective-controller.mjs` decides when a red wave may expand while `orchestration-autonomy` and `orchestrator-run-state` also expose continuation decisions.
- The finite runner computes thresholds and also calls the run-state reducer, so evidence production and terminal authority are not fully separated.
- SLOS has its own completion claim gate despite being compatibility-only.
- Full Parity Engine and the objective decomposer both emit work graphs with different schema families.
- Worker invocation evidence is split between creative/live transfer worker scripts.

These are migration inputs, not evidence that Phase 1 has already consolidated runtime behavior. Runtime movement starts only after golden compatibility fixtures are green.
