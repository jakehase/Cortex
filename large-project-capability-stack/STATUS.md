# Agent Work v1 Status

## Metadata

- Project slug: `agent-work-orchestration-v1`
- Canonical plan: `/root/clawd/large-project-capability-stack/plan.md`
- Decisions log: `/root/clawd/large-project-capability-stack/DECISIONS.md`
- Last updated: `2026-07-10`
- Status: `active — quality-gate sequencing/resume-clock repair validated and the corrected GPT-5.6 Sol soak resumed from preserved wave 8 state; no six-hour soak credit unless terminal threshold green`
- Current fidelity: `production_slice implementation toward production platform v1`

## Current checkpoint

- The canonical plan targets **Agent Work v1**, a proof-carrying objective orchestrator around Cortex/OpenClaw and Codex/model workers.
- Canonical implementation path remains `/root/clawd/large-project-capability-stack`.
- Phase 1 contract and authority freeze is green.
- Phase 2 stable facade/operator CLI is green.
- Phase 3 durable runtime and recovery is green.
- Phase 4 objective planning, inventories, and continuous expansion is green as a bounded production-slice planning contract.
- Phase 5 Codex worker adapter, isolated workspace, provider-evidence capture, patch bundle, conflict detection, merge lane, cleanup evidence, and worker execution packet are green for one tiny bounded real Codex worker proof on Hetzner.
- Phase 6 independent verifier adapters and completion-truth packets are green as a production-slice implementation with local + remote qualification.
- Phase 7 operations, security, and remote-deployment readiness is green as a production-slice implementation with local + Hetzner qualification.
- Phase 8 release-candidate mechanics are implemented and started. Deterministic local/remote no-model qualification is green, the 4 physical-worker real model canary is green, the 8-worker restart/fault campaign is green, the bounded AI OS product-platform workload is green, the bounded brownfield PMHNP transfer workload is green, and the 12-worker productive cross-repo campaign is green. A GPT-5.5 audit preserved these scoped subgate claims because the contracts are Codex/provider-evidence based rather than model-minor-version based. The first six-hour soak was stopped with no credit after it accumulated 32,196 lines in only four files while production-quality and objective-truth gates were disabled. A corrected GPT-5.6 Sol canary then proved productive two-worker waves but exposed an honest scale blocker; the controller now counts fresh wave-qualified worker process invocations separately from reused local labels and uses controller wall-clock duration with active-wave runtime retained as a separate metric. A fresh persistent 360-minute run launched on Hetzner at `2026-07-10 20:12 CDT` from a 1,000-surface objective spanning 39 product files and 25 targeted tests, with both truth gates enabled. It first stopped blocked after 8 waves/16.33 minutes because the objective matrix became complete before the final production-quality artifact existed; the controller treated `production_quality_gate_missing` as terminal instead of continuing the remaining duration/workload. The controller sequencing, final-gate reevaluation, quality-artifact binding, and stopped-downtime accounting were repaired and validated; the product-regression command passes 30/30 against both current and clean baseline. The campaign resumed from preserved wave 8 state at `2026-07-10 21:40 CDT`, and wave 9 proved the missing final artifact is now deferred rather than terminal. Phase 8 release-candidate remains blocked pending terminal six-hour evidence and independent review.

## Phase 6 implemented mechanics

- Canonical package: `packages/agent-work-verifier`.
- Public facade package `packages/canonical-agent-work` now exports the verifier package and surfaces Phase 6 truth in `verify`, `report`, and `doctor`.
- `buildVerifierAdapter()` records a stable verifier adapter for deterministic command, schema/static, runtime integration, browser/visual packet, and manual-review packet verifier types.
- `createVerificationContext()` creates a clean copied verifier context bound to source digest, patch-bundle digest, and context digest.
- `runVerifierAdapter()` executes/verifies in that clean context and records digest-bound verifier evidence.
- `validateVerifierEvidence()` rejects stale, forged, skipped, timed-out, worker-authored, non-independent, or digest-mismatched evidence.
- `buildVerifierMatrix()` reduces required verifier results into green/red verifier truth.
- `buildCompletionTruthPacket()` combines worker execution, verifier matrix, claim ledger, objective truth, and mechanical-green state into terminal truth.
- Matrix green cannot override a failed claim ledger.
- Mechanical green cannot override red objective truth.
- Terminal red states produce blocker packets via `buildTerminalBlockerPacket()`.
- Terminal green states produce exact hashed allowed claims via `buildTerminalClaimPacket()`.
- `config/agent-work-v1/default.json` now records `requireIndependentVerification=true`.
- `docs/agent-work-v1/PUBLIC_FACADE_BEHAVIOR.md` documents the Phase 6 verifier/completion-truth boundary.

## Phase 7 implemented mechanics

- Canonical package: `packages/agent-work-ops`.
- Public facade package `packages/canonical-agent-work` exports the ops package and surfaces Phase 7 operations readiness in `verify`, `report`, and `doctor`.
- `buildExecutionPlaneInstallManifest()` records execution-plane install/config/supervisor/health-check intent.
- `buildRemoteDoctorPacket()` records live remote host/user/runtime/tooling/workspace/disk/execution-plane facts.
- `buildHeartbeatAndArtifactSyncPacket()` records heartbeat freshness, bounded log rotation, artifact return path, disk alarms, budget alarms, and control-plane notifier placement.
- `buildControlPlaneSeparationPacket()` records emergency stop, graceful drain, durable cancel, remote reconciliation before resume, notifier-loss truth invariance, and runner-loss blocker notification.
- `buildSecurityReadinessPacket()` proves malicious path/command/secret fixtures fail closed.
- `buildBackupRestoreReadinessPacket()` records source digest, backup hash, restore/replay status, and fresh-checkout recovery runbook requirements.
- `buildOperationsReadinessPacket()` reduces the Phase 7 gates into `operations_readiness_packet.json` and allows only an operations-readiness claim when every gate is green.
- `config/agent-work-v1/default.json` now records `requireOpsReadiness=true`.
- `docs/agent-work-v1/PHASE7_OPERATIONS_RUNBOOK.md` documents the Phase 7 operating boundary and standard Hetzner qualification pattern.
- `docs/agent-work-v1/PUBLIC_FACADE_BEHAVIOR.md` documents the Phase 7 operations/security/remote-deployment truth boundary.

## Phase 8 implemented mechanics and started evidence

- Canonical package: `packages/agent-work-release-candidate`.
- Public facade package `packages/canonical-agent-work` exports the release-candidate package and surfaces Phase 8 release-candidate truth in `verify`, `report`, and `doctor`.
- `buildWorkloadQualificationPacket()` records each Phase 8 workload-class attempt: shared-stack self-dogfood, AI OS/product-platform, clone/parity slice, and brownfield transfer.
- Workload green requires product diff, provenance, independent verification, no external actions in worker context, and clone negative-space checks when relevant.
- Workload-specific blockers can be admitted only as specific blockers; at least three workload classes must still complete green.
- `buildScaleDurationPacket()` requires observed physical workers/model calls, 2-4 worker canary, 8-worker fault campaign, 12-worker cross-repo campaign, positive provider usage, and six-hour real-work multi-wave soak evidence. The soak gate now also requires completed provider calls/tokens, productive surface diversity across at least 12 changed product files, enabled+green production-quality and objective-truth gates, and green targeted verification.
- `buildFaultReplayPacket()` requires deterministic no-model suite, controller restart, worker loss, verifier failure, stale lease, conflict, provider error, budget exhaustion, disk pressure, zero false greens, clean-room replay, full tests, project gates, and source-sync hash match.
- `buildIndependentReleaseReviewPacket()` requires reviewer identity, source/artifact digests, exact allowed claim, inflated-claim rejection, and non-dirty source state.
- `buildReleaseCandidatePacket()` reduces all Phase 8 evidence into `release_packet.json`.
- `buildPhase8PreflightPacket()` intentionally writes a blocked preflight packet until real workload, scale, soak, replay, and review evidence exists.
- `config/agent-work-v1/default.json` now records `requireReleaseCandidateQualification=true`.
- `docs/agent-work-v1/PHASE8_RELEASE_CANDIDATE_RUNBOOK.md` documents the Phase 8 evidence order, workload classes, scale/soak rules, failure fixtures, and truth boundary.

## Latest validation

Local control-plane Phase 8 deterministic validation on `2026-07-10`:

```bash
cd /root/clawd/large-project-capability-stack
node --test tests/agent-work-release-candidate.test.mjs tests/agent-work-ops.test.mjs tests/agent-work-verifier.test.mjs tests/agent-work-v1-cli.test.mjs
# 27/27 pass
npm test
# 410/410 pass
node apps/system-benchmark/canonical-agent-work.mjs doctor --json
# ok=true, state=green
```

Remote Hetzner Phase 8 deterministic validation on `clawd-exec-hel1` at `/home/jake/clawd-remote/qualification/agent-work-phase8-20260710T185013Z/large-project-capability-stack`:

- Workspace public Cortex tree linked: `true`.
- Runtime: Node `v22.22.2`, npm `10.9.7`.
- Codex path: `/home/jake/.local/bin/codex`.
- Remote disk checkpoint: `314GB` free under `/home/jake/clawd-remote`.
- Focused Phase 8 suite: `27/27` pass.
- Full remote suite: `410/410` pass.
- Remote doctor: `ok=true`, `state=green`, `hostRole=execution_plane`.
- Selected-file sync hash match: `true`.

Remote Hetzner Phase 8 real-worker canary on the same qualification root:

- Canary root: `/root/clawd/large-project-capability-stack/artifacts/agent-work-v1/phase-8-release-candidate/real-worker-canary-4w`.
- Remote canary source root: `/home/jake/clawd-remote/qualification/agent-work-phase8-20260710T185013Z/large-project-capability-stack/artifacts/agent-work-v1/phase-8-release-candidate/real-worker-canary-4w`.
- Run id: `phase8-canary-4w-20260710T185013Z`.
- Threshold pass: `true`.
- Supervisor confirmed completion: `true`.
- Peak concurrency: `4`.
- Unique observed agents: `4` (`agent-1` through `agent-4`).
- Productive merged patches: `4/4`.
- Verified surfaces: `4/4`.
- Provider-observed tokens: `80942`.
- Active worker runtime: `195789ms`; wall-clock `56769ms`.
- Credited product files: `packages/canary-01/index.mjs` through `packages/canary-04/index.mjs`.

Remote Hetzner Phase 8 restart/fault campaign on the same qualification root:

- Campaign root: `/root/clawd/large-project-capability-stack/artifacts/agent-work-v1/phase-8-release-candidate/restart-fault-campaign-8w`.
- Remote campaign source root: `/home/jake/clawd-remote/qualification/agent-work-phase8-20260710T185013Z/large-project-capability-stack/artifacts/agent-work-v1/phase-8-release-candidate/restart-fault-campaign-8w`.
- Run id: `phase8-fault-8w-20260710T185013Z`.
- Status: `green`.
- Execution plane: `clawd-exec-hel1`, `hostRole=execution_plane`.
- Observed physical worker processes: `8`.
- Fault fixtures green: controller restart, worker loss, verifier failure, stale lease, conflict, provider error, budget exhaustion, disk pressure.
- Runtime clean-room replay: green with matching replay digest.
- Adversarial false greens: `0`.

Remote Hetzner Phase 8 AI OS product-platform workload:

- Workload root: `/root/clawd/large-project-capability-stack/artifacts/agent-work-v1/phase-8-release-candidate/ai-os-product-platform-workload-r3`.
- Remote workload root: `/home/jake/clawd-remote/qualification/agent-work-phase8-20260710T185013Z/large-project-capability-stack/artifacts/agent-work-v1/phase-8-release-candidate/ai-os-product-platform-workload-r3`.
- Remote AI OS source copy: `/home/jake/clawd-remote/qualification/agent-work-phase8-20260710T185013Z/ai-os-product-platform/ai-os`.
- Run id: `phase8-aios-product-4w-r3-20260710T185013Z`.
- Benchmark tier: `real_worker_product_standard`.
- Pre-worker targeted tests: failed as intended (`exitCode=1`) against pending stubs.
- Threshold pass: `true`.
- Supervisor confirmed completion: `true`.
- Mechanical green: `true`.
- Scale proof ready: `true`.
- Peak concurrency: `4`.
- Unique observed agents: `4`.
- Productive merged patches: `4/4`.
- Provider-observed tokens: `71090`.
- Credited AI OS product files:
  - `packages/aios-kernel/scheduler/phase8-execution-slot.mjs`
  - `packages/aios-kernel/verifier-claim-gate/phase8-evidence-reducer.mjs`
  - `packages/aios-language/runtime/phase8-capability-digest.mjs`
  - `packages/aios-language/runtime/phase8-job-intake.mjs`

Remote Hetzner Phase 8 brownfield PMHNP transfer workload:

- Workload root: `/root/clawd/large-project-capability-stack/artifacts/agent-work-v1/phase-8-release-candidate/brownfield-pmhnp-workload`.
- Remote workload root: `/home/jake/clawd-remote/qualification/agent-work-phase8-20260710T185013Z/large-project-capability-stack/artifacts/agent-work-v1/phase-8-release-candidate/brownfield-pmhnp-workload`.
- Remote PMHNP code-only source copy: `/home/jake/clawd-remote/qualification/agent-work-phase8-20260710T185013Z/brownfield-pmhnp/pmhnp-denial-copilot`.
- Source sync excluded `.git`, `node_modules`, `artifacts`, `state`, `backups`, `.env*`, and `docs/recovery` so workers did not receive checked-in state or recovery probe files.
- Remote baseline `npm run smoke` passed before worker launch.
- Run id: `phase8-brownfield-pmhnp-4w-20260710T185013Z`.
- Benchmark tier: `real_worker_product_standard`.
- Pre-worker targeted tests: failed as intended (`exitCode=1`) against pending stubs.
- Threshold pass: `true`.
- Supervisor confirmed completion: `true`.
- Mechanical green: `true`.
- Scale proof ready: `true`.
- Peak concurrency: `4`.
- Unique observed agents: `4`.
- Productive merged patches: `4/4`.
- Provider-observed tokens: `116801`.
- Credited PMHNP product files:
  - `src/domain/phase8AppealChecklist.mjs`
  - `src/domain/phase8ClaimRiskNormalizer.mjs`
  - `src/domain/phase8ExportGuard.mjs`
  - `src/domain/phase8RoiTriage.mjs`

Remote Hetzner Phase 8 12-worker productive cross-repo campaign:

- Campaign root: `/root/clawd/large-project-capability-stack/artifacts/agent-work-v1/phase-8-release-candidate/cross-repo-12w-campaign-r2`.
- Remote campaign root: `/home/jake/clawd-remote/qualification/agent-work-phase8-20260710T185013Z/large-project-capability-stack/artifacts/agent-work-v1/phase-8-release-candidate/cross-repo-12w-campaign-r2`.
- Run id: `phase8-crossrepo-12w-r2-20260710T185013Z`.
- Benchmark tier: `real_worker_product_standard`.
- First attempt `phase8-crossrepo-12w-20260710T185013Z` was red and not credited because nested aggregate repo paths were rejected before Codex/model work (`0` provider tokens). The r2 fix admitted safe nested aggregate product paths for `large-project-capability-stack/`, `ai-os/`, and `pmhnp-denial-copilot/` code-only surfaces.
- Pre-worker targeted tests: failed as intended (`exitCode=1`) against pending stubs.
- Threshold pass: `true`.
- Supervisor confirmed completion: `true`.
- Mechanical green: `true`.
- Scale proof ready: `true`.
- Peak concurrency: `12`.
- Unique observed agents: `12`.
- Productive merged patches: `12/12`.
- Provider-observed tokens: `223981`.
- Credited cross-repo product files: `12` across shared stack, AI OS, and PMHNP code-only aggregate paths.

Phase 8 proof artifacts:

- Release packet: `/root/clawd/large-project-capability-stack/artifacts/agent-work-v1/phase-8-release-candidate/release-candidate/release_packet.json` (`status=blocked`, `releaseCandidateClaimAllowed=false`).
- Qualification matrix: `/root/clawd/large-project-capability-stack/artifacts/agent-work-v1/phase-8-release-candidate/release-candidate/qualification_matrix.json` (`status=blocked`, `greenWorkloadCount=3`; remaining matrix gates are scale/duration because six-hour soak is not run yet, and independent review).
- Local surface matrix: `/root/clawd/large-project-capability-stack/artifacts/agent-work-v1/phase-8-release-candidate/surface_matrix.json` (`status=blocked`; deterministic, 4-worker canary, 8-worker fault, AI OS workload, brownfield workload, and 12-worker cross-repo rows complete).
- Local supervisor packet: `/root/clawd/large-project-capability-stack/artifacts/agent-work-v1/phase-8-release-candidate/supervisor_packet.json` (`supervisorStatus=blocked`).
- 4-worker canary packet: `/root/clawd/large-project-capability-stack/artifacts/agent-work-v1/phase-8-release-candidate/real_worker_canary_4w_packet.json` (`status=green`).
- 8-worker restart/fault packet: `/root/clawd/large-project-capability-stack/artifacts/agent-work-v1/phase-8-release-candidate/restart-fault-campaign-8w/fault_campaign_packet.json` (`status=green`).
- AI OS product-platform workload packet: `/root/clawd/large-project-capability-stack/artifacts/agent-work-v1/phase-8-release-candidate/ai_os_product_platform_workload_packet.json` (`status=green`).
- Brownfield PMHNP transfer workload packet: `/root/clawd/large-project-capability-stack/artifacts/agent-work-v1/phase-8-release-candidate/brownfield_transfer_workload_packet.json` (`status=green`).
- 12-worker cross-repo packet: `/root/clawd/large-project-capability-stack/artifacts/agent-work-v1/phase-8-release-candidate/cross_repo_12w_packet.json` (`status=green`).
- Local test summary: `/root/clawd/large-project-capability-stack/artifacts/agent-work-v1/phase-8-release-candidate/test_summary.json`.
- Remote proof: `/root/clawd/large-project-capability-stack/artifacts/agent-work-v1/remote-phase8-20260710T185013Z/remote-proof.json`.
- Remote test summary: `/root/clawd/large-project-capability-stack/artifacts/agent-work-v1/remote-phase8-20260710T185013Z/remote-test-summary.json`.
- Sync hash proof: `/root/clawd/large-project-capability-stack/artifacts/agent-work-v1/remote-phase8-20260710T185013Z/sync-hash-proof.json`.

## Latest Phase 7 validation

Local control-plane Phase 7 validation on `2026-07-10`:

```bash
cd /root/clawd/large-project-capability-stack
node --test tests/agent-work-ops.test.mjs
# 6/6 pass
npm test
# 404/404 pass
node apps/system-benchmark/canonical-agent-work.mjs doctor --json
# ok=true, state=green
```

Remote Hetzner Phase 7 validation on `clawd-exec-hel1` at `/home/jake/clawd-remote/qualification/agent-work-phase7-20260710T180037Z/large-project-capability-stack`:

- Workspace public Cortex tree linked: `true`.
- Runtime: Node `v22.22.2`, npm `10.9.7`.
- Codex path: `/home/jake/.local/bin/codex`.
- Remote disk checkpoint: `314GB` free under `/home/jake/clawd-remote`.
- Focused Phase 7 suite: `6/6` pass.
- Full remote suite: `404/404` pass.
- Remote doctor: `ok=true`, `state=green`, `hostRole=execution_plane`.
- Selected-file sync hash match: `true`.

Phase 7 proof artifacts:

- Operations readiness packet: `/root/clawd/large-project-capability-stack/artifacts/agent-work-v1/phase-7-ops/operations_readiness_packet.json` (`status=green`, `operationsClaimAllowed=true`).
- Local surface matrix: `/root/clawd/large-project-capability-stack/artifacts/agent-work-v1/phase-7-ops/surface_matrix.json` (`status=all_complete`).
- Local supervisor packet: `/root/clawd/large-project-capability-stack/artifacts/agent-work-v1/phase-7-ops/supervisor_packet.json` (`supervisorStatus=green`).
- Local completion summary: `/root/clawd/large-project-capability-stack/artifacts/agent-work-v1/phase-7-ops/completion_summary.json`.
- Local test summary: `/root/clawd/large-project-capability-stack/artifacts/agent-work-v1/phase-7-ops/test_summary.json`.
- Remote proof: `/root/clawd/large-project-capability-stack/artifacts/agent-work-v1/remote-phase7-20260710T180037Z/remote-proof.json`.
- Remote test summary: `/root/clawd/large-project-capability-stack/artifacts/agent-work-v1/remote-phase7-20260710T180037Z/remote-test-summary.json`.
- Sync hash proof: `/root/clawd/large-project-capability-stack/artifacts/agent-work-v1/remote-phase7-20260710T180037Z/sync-hash-proof.json`.

## Latest Phase 6 validation

Local control-plane validation on `2026-07-10`:

```bash
cd /root/clawd/large-project-capability-stack
node --test tests/agent-work-verifier.test.mjs
# 6/6 pass
npm test
# 398/398 pass
node apps/system-benchmark/canonical-agent-work.mjs doctor --json
# ok=true, state=green
```

Remote Hetzner validation on `clawd-exec-hel1` at `/home/jake/clawd-remote/qualification/agent-work-phase6-20260710T151258Z/large-project-capability-stack`:

- Workspace public Cortex tree linked: `true`.
- Runtime: Node `v22.22.2`, npm `10.9.7`.
- Focused Phase 6 suite: `6/6` pass.
- Full remote suite: `398/398` pass.
- Remote doctor: `ok=true`, `state=green`.
- Selected-file sync hash match: `true`.

Phase 6 proof artifacts:

- Local surface matrix: `/root/clawd/large-project-capability-stack/artifacts/agent-work-v1/phase-6-truth/surface_matrix.json` (`status=all_complete`).
- Local supervisor packet: `/root/clawd/large-project-capability-stack/artifacts/agent-work-v1/phase-6-truth/supervisor_packet.json` (`supervisorStatus=green`).
- Local completion summary: `/root/clawd/large-project-capability-stack/artifacts/agent-work-v1/phase-6-truth/completion_summary.json`.
- Local test summary: `/root/clawd/large-project-capability-stack/artifacts/agent-work-v1/phase-6-truth/test_summary.json`.
- Remote proof: `/root/clawd/large-project-capability-stack/artifacts/agent-work-v1/remote-phase6-20260710T151258Z/remote-proof.json`.
- Remote test summary: `/root/clawd/large-project-capability-stack/artifacts/agent-work-v1/remote-phase6-20260710T151258Z/remote-test-summary.json`.
- Sync hash proof: `/root/clawd/large-project-capability-stack/artifacts/agent-work-v1/remote-phase6-20260710T151258Z/sync-hash-proof.json`.

## Remote rerun note

The first remote full Phase 6 run was `396/398` because the qualification root was source-only and omitted sibling `public/cortex_server`, which legacy SLOS compatibility tests require. After linking `/home/jake/clawd-remote/public` into the remote qualification root, the same Phase 6 code passed the full remote suite `398/398`. No product code change was made for that rerun.

## Resolved blockers

### Phase 5 real provider blocker

Prior blocker:

```text
code: real_codex_provider_evidence_required
family: provider_evidence
```

Resolution:

- Jake approved the worker proof on `2026-07-10 09:03 CDT`.
- A real Codex CLI worker proof ran on Hetzner through the Phase 5 adapter path.
- Provider usage was parsed from Codex `--json` events, not a worker-written fixture ledger.
- The proof produced non-null command/model/runtime/provider evidence, a scoped product-file change, green patch bundle, serializable conflict report, green merge receipt, preserved cleanup evidence, and green worker execution packet.

### Phase 6 remote context blocker

Observed during Phase 6 remote proof:

```text
remote full suite: 396/398
cause: qualification root missing sibling public/cortex_server context required by legacy compatibility tests
```

Resolution:

- Linked `/home/jake/clawd-remote/public` to `/home/jake/clawd-remote/qualification/agent-work-phase6-20260710T151258Z/public`.
- Reran focused and full remote qualification.
- Remote focused Phase 6: `6/6`.
- Remote full suite: `398/398`.

## Active blockers

Phase 8 release-candidate qualification remains blocked by missing later-gate evidence. Deterministic qualification, 4-worker real canary, 8-worker restart/fault campaign, AI OS product-platform workload, brownfield PMHNP transfer workload, and 12-worker productive cross-repo campaign are complete.

Current running condition: `production_quality_gate_missing` is now deferred while duration-pending grounded work remains; broader milestone remains `phase8_corrected_six_hour_soak_and_review_required`.

The first soak attempt is preserved as blocker evidence and receives no credit. At 139.72 minutes it had 34 waves, 68 merged shards, 3,656,740 observed tokens, only four changed product files totaling 32,196 lines, and disabled production-quality/objective-truth gates. It was stopped at PID `1933954`; remote audit evidence is under `run-v2/audit-stop-20260711T0022Z`. Local model-version audit: `artifacts/agent-work-v1/phase-8-release-candidate/model-version-audit-20260710.json`.

Corrected stopped run:

- Benchmark/run id: `agent_work_phase8_mailchimp_grounded_soak` / `phase8-mailchimp-sol-full-soak`.
- Remote root: `/home/jake/clawd-remote/qualification/agent-work-phase8-corrected-soak-20260711T004019Z/full`; canonical artifacts `.../full/run`.
- Runtime: `16.33` wall minutes / `14.91` summed wave minutes; 8 waves; exit code `1`.
- Productive work: 15/16 shards merged; 16 wave-qualified worker invocations; 501,309 observed tokens; scale proof green; 13 changed tracked product files; direct diff `+2006/-61` (net `+1945`); artifact duplicate-normalized-line ratio `0.1099`; zero route collisions.
- Verification: external/targeted verification integrity `1`; fresh rerun of the workload’s 25 targeted files passed `30/30` subtests.
- Final status: `thresholdPass=false`, objective truth red, production quality red, no soak credit.
- Root cause: after the 26 objective rows were credited complete, objective truth had no repair queue and the final production-quality artifact did not yet exist. The controller stopped with `production_quality_gate_missing` instead of continuing the remaining 1,000-surface inventory to the 360-minute duration target.
- Quality-gate nuance: broad `npm test` reported 31 failures in four orchestration/harness files whose expectations are dirty-repo/saturation-sensitive; the product-targeted suite remained green. This requires an explicit gate-command/baseline policy repair, not silent waiver.

Repair/resume status:

- Controller now defers a missing final quality artifact while the duration target and grounded inventory remain, binds objective truth to `run/production_quality_gate.json`, re-evaluates terminal truth after the final gate, and reconstructs the resume clock from prior active elapsed time so stopped downtime receives no soak credit.
- Added regression tests; focused local and remote suites pass `53/53`.
- Product-quality preflight against current repo and clean `HEAD` baseline passed `30/30` on both sides with zero regressions, duplicate ratio `0.1099`, and no route collisions.
- Attempt-1 terminal artifacts are preserved under `.../full/attempt1-blocked-audit/` with hashes.
- Resumed at `2026-07-10 21:40 CDT` (`2026-07-11T02:40:49Z`) from wave 8. Wave 9 completed 2/2 mechanically green, no context-budget failures, and the controller continued despite the intentionally deferred missing final quality artifact. Resume launcher PID `2055256` at verification.

## Next actions

1. Let the resumed persistent campaign run to the 360-minute active controller target or a new precise blocker.
2. On terminal exit, audit final quality/baseline, objective truth, scale/provider evidence, diff breadth/repetition, and canonical threshold artifacts.
3. Complete independent release review/final claim audit only after a real six-hour threshold-green soak. No current release, parity, or soak claim is allowed.

## Current milestone

`phase_8_cross_repo_qualification_release_candidate_green_or_blocker`

Phase 8 continuation should not start from chat memory. Start from:

1. `/root/clawd/large-project-capability-stack/plan.md`.
2. This `STATUS.md`.
3. Phase 8 supervisor packet, release packet, qualification matrix, and 4-worker canary packet.
4. Phase 7 supervisor packet and surface matrix.
5. Phase 6 supervisor packet and surface matrix.
6. Phase 5 real Codex proof artifacts.

Completed Phase 8 gates so far: deterministic no-model suite, 2-4 physical-worker real canary, 8-worker restart/fault campaign, bounded AI OS product-platform workload, bounded brownfield PMHNP transfer workload, and 12-worker productive cross-repo campaign. The Phase 8 workload matrix has the required three green workload classes.

Remaining Phase 8 direction from the current plan: corrected six-hour unattended real-work soak, independent release review, and claim audit. Mailchimp clone/parity slice remains optional/additional evidence.

## Do not use / superseded

- Prior high-level Cortex/Codex consolidation roadmap — superseded by `plan.md` on `2026-07-10`; its decisions/evidence remain valid.
- `_quarantine/synthetic-labor-os-legacy-20260707/` — historical replay/audit only.
- SLOS v19 — compatibility release-packet adapter only.
- SLOS v20 — mechanism donor/qualification reference, not a second canonical runtime.
- `artifacts/**` repository snapshots — evidence only, never active source.
- `_rerun_*` or workspace snapshot paths — historical/scratch, not implementation paths.

## Truth boundary

Allowed claim:

- Agent Work v1 Phase 1 contract/authority freeze is green.
- Agent Work v1 Phase 2 stable facade/operator CLI is green as a production-slice implementation.
- Agent Work v1 Phase 3 durable runtime/recovery is green as a production-slice implementation.
- Agent Work v1 Phase 4 objective planning/inventory expansion is green as a production-slice implementation.
- Agent Work v1 Phase 5 worker adapter/isolation/merge lane is green for one tiny bounded real Codex worker proof on Hetzner.
- Agent Work v1 Phase 6 independent verifier/completion-truth mechanics are green as a production-slice implementation with local and remote qualification.
- Agent Work v1 Phase 7 operations/security/remote-deployment readiness is green as a production-slice implementation with local and Hetzner qualification.
- Agent Work v1 Phase 8 has started: deterministic release-candidate mechanics/local+remote no-model qualification are green, the 4-worker real model canary is green, the 8-worker restart/fault campaign is green, the bounded AI OS product-platform workload is green, the bounded brownfield PMHNP transfer workload is green, and the 12-worker productive cross-repo campaign is green.

Not allowed yet:

- Agent Work v1 is released, production-ready, or end-to-end complete.
- The current system has passed full Phase 8 release-candidate qualification, six-hour soak, release completion, full parity, universal autonomy, production deployment, or 100 physical workers.
- Completed Phase 8 subgates, including 12-worker cross-repo scale, do not by themselves prove release-candidate green, release readiness, six-hour soak, full parity, AI OS runtime replacement, external-write enablement, or a production deployment.
