# Agent Work v1 public facade behavior contract

Status: Phase 8 release-candidate mechanics are implemented as a production-slice contract. Phase 8 can prove release-candidate qualification for supplied evidence; it is still not Phase 9 release, public production deployment, universal/full parity, or 100-physical-worker qualification.

## Stable owner

All supported product calls go through `packages/canonical-agent-work`. Internal packages remain implementation details. Benchmark and SLOS paths are qualification or compatibility consumers, not public Agent Work APIs.

## Required operations

| Operation | Current behavior | V1 terminal behavior |
|---|---|---|
| `compileObjective` / `plan` | Compile current Cortex/DSL input, materialize validated v1 contracts, write `cli_contract_packet.json`, generate Phase 4 target/reference inventories, negative-space rows, verifier-backed work graph, continuation policy, and plan-review digest, then initialize `run.db`/`run_events.jsonl` when planning is green. | Add release-scale worker/verifier orchestration and final release packets. |
| `admitRun` / `run` | Public fail-closed admission gate. If `requirePlanApproval=true`, the exact `plan_review_packet.planDigest` must be approved before admission. `remote_execution_required` run roots still block on control-plane hosts. On the execution plane, `run` requires a green Phase 5 `worker_execution_packet.json` before reporting worker progress. | Fail closed unless contracts, policy, approval, placement, budgets, runtime readiness, worker adapter gates, merge admission, and verifier gates pass. |
| `getRunStatus` / `status` | Public artifact-backed status from run manifest, blocker/cancellation artifacts, Phase 4 planning artifacts, Phase 5 worker-execution packet when present, Phase 6 truth packet when present, Phase 7 ops packet when present, Phase 8 release-candidate packet when present, and deterministic runtime projection; never from chat/log inference. | Read durable projected truth; never infer terminal state from PID/log text alone. |
| `resumeRun` / `resume` | Durably appends a resume event, rebuilds projection, and writes a recovery qualification packet. | Reconcile remote state and fenced leases before new work. |
| `cancelRun` / `cancel` | Durably appends a cancellation event, writes `cancellation.json`, preserves events/state, and returns stable cancellation exit code `4`. | Durably cancel, stop new leases, drain/stop active workers, preserve evidence. |
| `verifyRun` / `verify` | Validates the v1 contract bundle, Phase 4 planning packet, plan-review digest state, durable runtime presence, Phase 5 worker-execution packet, Phase 6 truth packet, Phase 7 ops packet, and Phase 8 release-candidate packet when present. `completionClaimAllowed=true` only when Phase 6 truth is green; `operationsClaimAllowed=true` only when Phase 7 ops is green; `releaseCandidateClaimAllowed=true` only when Phase 8 release packet is green. | Run clean digest-bound independent verification, ops-readiness qualification, and release-candidate qualification. |
| `buildCompletionPacket` / `report` | Writes `phase8_report_packet.json` with planning status, plan digest, runtime digest, Phase 5 worker-execution status, Phase 6 truth status, Phase 7 ops status, Phase 8 release-candidate status, and exact allowed claims for each green layer. | Return exact allowed/rejected claims from terminal evidence. |
| `doctor` | Checks local/control-plane facade readiness, planning package, execution package, verifier package, ops package, release-candidate package, runtime package, `node:sqlite`, rsync, and optional execution-plane role without model calls. | Check control/execution role, source, state store, worker provider, verifier provider, artifact store, budgets, security policy, and release-candidate package. |
| `replayRun` / `replay` | Deterministically rebuilds runtime state from `run_events.jsonl`, rewrites projection/truth artifacts, and writes a recovery packet. | Deterministically rebuild state from portable events and artifact hashes. |

## Phase 5 worker execution packet boundary

`packages/agent-work-execution` defines the worker evidence contract:

1. `buildWorkerAdapterContract()` records a versioned Codex-first adapter contract, command, ordered args, model, context/token budgets, timeout, output cap, and validation checks.
2. `providerUsageFromCodexJsonl()` derives provider-observed usage from Codex `--json` event streams rather than worker self-report.
3. `buildContextManifest()` and `provisionIsolatedWorkspace()` copy only allowed worker context into an isolated execution workspace.
4. `runCodexWorkerAdapter()` records command/model/runtime/stdout/stderr, provider usage, isolated workspace digest, and modified files.
5. `buildPatchBundle()` stages worker deltas and rejects out-of-scope file writes before merge.
6. `detectPatchConflicts()` blocks divergent same-file patch bundles instead of silently overwriting work.
7. `mergePatchBundle()` applies canonical source changes only after patch-bundle, baseline, scope, lease/fencing, and merge-lane checks pass.
8. `cleanupWorkerWorkspace()` removes ephemeral workspaces only after evidence is preserved.
9. `buildWorkerExecutionPacket()` reduces all checks into `worker_execution_packet.json`.

A real Codex worker claim requires command visibly invoking Codex, model recorded, positive runtime, provider calls started/completed, and provider-observed token usage greater than zero.

## Phase 6 verifier and completion-truth boundary

`packages/agent-work-verifier` defines the independent verifier and terminal truth contract:

1. `buildVerifierAdapter()` records a stable verifier adapter for deterministic command, schema/static, runtime integration, browser/visual packet, or manual-review packet verifiers.
2. `createVerificationContext()` creates a clean copied context bound to source digest and optional patch-bundle digest.
3. `runVerifierAdapter()` executes/verifies inside that clean context and writes digest-bound verifier evidence.
4. `validateVerifierEvidence()` rejects stale, forged, skipped, worker-authored, timeout, or digest-mismatched evidence.
5. `buildVerifierMatrix()` reduces required verifier results into green/red verifier truth.
6. `buildCompletionTruthPacket()` combines worker execution, verifier matrix, claim ledger, objective truth, and mechanical-green state.
7. Matrix green cannot override a failed claim ledger.
8. Mechanical green cannot override red objective truth.
9. Terminal red states emit a blocker packet.
10. Terminal green states emit an exact terminal claim packet with hashed evidence and allowed claims.

Phase 6 can allow bounded completion claims for supplied evidence. It does not imply release readiness, cross-repo qualification, scale tier, six-hour soak, full clone, or full parity.

## Phase 7 operations/security/remote-deployment boundary

`packages/agent-work-ops` defines the ops-readiness contract:

1. `buildExecutionPlaneInstallManifest()` records execution-plane install intent, service/supervisor facts, health commands, runtime identity, and notifier placement.
2. `buildRemoteDoctorPacket()` records live remote readiness: host, non-root runtime user, Node/npm/rsync/Codex, workspace/public Cortex context, disk, and execution-plane role.
3. `buildHeartbeatAndArtifactSyncPacket()` records heartbeat freshness, log rotation, artifact return, disk alarms, budget alarms, and lightweight notifier placement.
4. `buildControlPlaneSeparationPacket()` records emergency stop, graceful drain, durable cancel, reconcile-before-resume, notifier-loss truth invariance, and runner-loss blocker notification.
5. `buildSecurityReadinessPacket()` requires malicious path/command/secret fixtures to fail closed.
6. `buildBackupRestoreReadinessPacket()` requires hashed backup, replay/restore proof, and a fresh-checkout recovery runbook.
7. `buildOperationsReadinessPacket()` reduces all Phase 7 gates into `operations_readiness_packet.json`.

Phase 7 can allow an operations-readiness claim. It does not imply release readiness, 12-worker scale, six-hour soak, cross-repo qualification, production deployment, full clone, or full parity.

## Phase 8 cross-repo qualification and release-candidate boundary

`packages/agent-work-release-candidate` defines the Phase 8 release-candidate contract:

1. `buildWorkloadQualificationPacket()` records each required workload class attempt: shared-stack self-dogfood, AI OS/product-platform, clone/parity slice, and brownfield transfer.
2. Workload green requires product diff, provenance, independent verification, no external actions in worker context, and clone negative-space checks when relevant.
3. Workload-specific blockers can be admitted only as specific blockers; at least three workload classes must still complete green.
4. `buildScaleDurationPacket()` requires observed physical workers/model calls, 2-4 worker canary, 8-worker fault campaign, 12-worker cross-repo campaign, positive provider usage, and six-hour real-work multi-wave soak evidence.
5. `buildFaultReplayPacket()` requires deterministic no-model suite, controller restart, worker loss, verifier failure, stale lease, conflict, provider error, budget exhaustion, disk pressure, zero false greens, clean-room replay, full tests, project gates, and source-sync hash match.
6. `buildIndependentReleaseReviewPacket()` requires reviewer identity, source/artifact digests, exact allowed claim, inflated-claim rejection, and non-dirty source state.
7. `buildReleaseCandidatePacket()` reduces all Phase 8 evidence into `release_packet.json`.
8. `buildPhase8PreflightPacket()` intentionally writes a blocked preflight packet until real workload, scale, soak, replay, and review evidence exists.

Phase 8 can allow a release-candidate claim only when every required gate is green. It does not imply Phase 9 release, production deployment, universal/full parity, universal autonomy, or 100 physical workers.

## Phase 1 compile guarantees

`compileCanonicalAgentWork()` must:

1. require object input and an output directory;
2. preserve the current Cortex → Agent Work DSL compiler artifacts;
3. upgrade the result into a validated Agent Work v1 contract bundle;
4. write objective, permission, budget, run manifest, and task contracts;
5. bind one stable plan digest;
6. deny external writes by default in the v1 compatibility contract;
7. record whether the current host may execute the contract;
8. make `compileGreen=false` if either the legacy compiler or v1 bundle is invalid;
9. avoid model calls or worker execution during planning;
10. state that compilation is not product completion.

## Exit and error behavior to preserve

Planned stable exit codes:

| Code | Meaning |
|---:|---|
| `0` | requested operation completed and its exact bounded claim is green |
| `1` | operation completed with a product/objective blocker or red verification |
| `2` | invalid input, policy denial, approval missing, or wrong execution boundary |
| `3` | infrastructure/provider/runtime failure with incident evidence |
| `4` | cancellation acknowledged |

All commands support JSON output with:

```json
{
  "ok": false,
  "operation": "run",
  "runId": "example",
  "state": "blocked",
  "blockerFamily": "remote_execution_boundary_required",
  "nextAction": "Run on the declared execution plane.",
  "artifacts": {}
}
```

No command may return `ok=true` merely because a process exited zero if objective or claim truth is red.

## Entrypoint rule

Package scripts beginning with `agent-work:` invoke the canonical product CLI at `apps/agent-work/cli.mjs` and must not point directly at benchmark controllers such as transfer runners or objective-controller internals. Scripts beginning with `benchmark:` remain qualification paths and receive no public-product authority. The pre-v1 `apps/system-benchmark/canonical-agent-work.mjs` location is a warning-emitting compatibility wrapper covered by migration and rollback tests.
