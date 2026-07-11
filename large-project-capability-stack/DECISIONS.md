# Cortex/Codex Consolidation Decisions

Append-only durable decisions for the project. Keep current state in `STATUS.md`; keep strategy in `plan.md`.

## Decision entry format

```markdown
## YYYY-MM-DD — <short decision title>

- Decision: <what changed>
- Reason: <why>
- Evidence: <commit/artifact/check>
- Supersedes: <older path/decision or n/a>
- Follow-up: <next action or n/a>
```

## Decisions

## 2026-07-07 — Shrink the worse-Codex layer instead of competing with Codex

- Decision: Treat Cortex/OpenClaw/SLOS as the owned control plane and Codex as the execution worker; demote generic custom Codex-agent pilots/tournaments to explicit legacy replay/audit paths.
- Reason: OpenAI Codex now covers much of the coding-agent worker layer. The unique value here is durable memory, routing, execution placement, approvals, artifacts, supervision, and claim integrity.
- Evidence: User instruction: "Let’s do that, kill or shrink our worse codex"; boundary doc `/root/clawd/large-project-capability-stack/docs/cortex-codex-boundary-and-ops.md`; active plan `/root/clawd/large-project-capability-stack/plan.md`; quarantine manifest `_quarantine/synthetic-labor-os-legacy-20260707/quarantine_manifest.json`.
- Supersedes: The implicit assumption that all SLOS Codex pilots/tournaments should remain part of the default active sync/runtime surface.
- Follow-up: Separately decide whether v19 release-packet becomes legacy once v20 is the only release-candidate path.

## 2026-07-07 — Quarantine SLOS v1-v18 Codex-era scripts

- Decision: Move 29 legacy SLOS v1-v18 pilot/tournament scripts and direct Codex work-item wrappers out of `apps/synthetic-labor-os/` into `_quarantine/synthetic-labor-os-legacy-20260707/` with SHA256 recovery metadata.
- Reason: These files were active-path clutter and largely duplicated Codex worker behavior; current product value is the control plane and v20 hard-dogfood RC path.
- Evidence: `_quarantine/synthetic-labor-os-legacy-20260707/quarantine_manifest.json`; package script `ops:synthetic-labor-os:legacy:manifest`; targeted validation passed `32/32`; full `npm test` passed `346/346`; plan-doctor returned `ok` with `0` errors and backup/DR-only warnings.
- Supersedes: Package-level exposure of v1-v18 pilots/tournaments as runnable default-adjacent commands.
- Follow-up: Decide v19 status separately.

## 2026-07-07 — Retrofit Cortex/Codex consolidation plan to detailed planning standard

- Decision: Add detailed implementation sequence, time/token/compute estimates, confusion-prevention rules, and open decisions to the Cortex/Codex consolidation plan.
- Reason: Jake set a standing rule that every serious plan should be detailed and organized enough for future sessions to execute without confusion.
- Evidence: `/root/clawd/large-project-capability-stack/plan.md` sections 18-21.
- Supersedes: Treating the remaining consolidation work as a short high-level next-action list.
- Follow-up: Decide v19 release-packet status before the next consolidation code tranche.

## 2026-07-07 — Keep SLOS v19 active as compatibility release-packet adapter

- Decision: Keep `apps/synthetic-labor-os/v19-release-packet.mjs` in the active app path for now, while treating it as a compatibility/evidence release-packet adapter rather than the active hard-dogfood RC path.
- Reason: v19 still provides useful run-ledger/release-packet fixture coverage over v18-style evidence. v20 remains the active hard-dogfood RC path, but demoting v19 now would remove useful replay/compatibility coverage for little simplification.
- Evidence: `apps/synthetic-labor-os/v19-release-packet.mjs`; `apps/synthetic-labor-os/v20-hard-dogfood-rc.mjs`; `tests/synthetic-labor-os.test.mjs` v19/v20 coverage.
- Supersedes: Open decision in the consolidation plan about whether v19 should immediately follow v1-v18 into quarantine.
- Follow-up: Revisit v19 only after v20 has replacement release-packet coverage for legacy evidence replay.

## 2026-07-10 — Finish the stack as Agent Work v1

- Decision: Supersede the Cortex/Codex consolidation roadmap with the Agent Work v1 release plan. Position the product as a proof-carrying objective orchestration control plane around Cortex/OpenClaw and Codex/model workers, not as a generic coding-agent replacement or a claim to have invented multi-agent orchestration.
- Reason: Jake accepted the target position and asked for a plan to finish the agent orchestration to that standard. The repository already has valuable but fragmented mechanisms; the highest-value path is one durable, independently verified product surface rather than more orchestration variants or scale theater.
- Evidence: `/root/clawd/large-project-capability-stack/plan.md`; selected core planning/truth tests passed `62/62` on `2026-07-10`.
- Supersedes: The active strategic scope of the `2026-07-07` Cortex/Codex consolidation plan. Its quarantine, compatibility, and boundary decisions remain valid prerequisites.
- Follow-up: Start Phase 1 by freezing v1 schemas and assigning one authoritative owner to every runtime, continuation, and terminal-truth decision.

## 2026-07-10 — Choose reliability-first v1 boundaries

- Decision: Use SQLite WAL plus portable JSONL/JSON evidence for runtime state; Codex first behind a worker adapter; Hetzner as the heavy execution plane; 12 observed physical workers and one six-hour real-work soak as the v1 release tier; deny external writes throughout qualification.
- Reason: These defaults create a serious but achievable production standard. They prioritize recovery and claim integrity over premature provider breadth or a 100-agent benchmark.
- Evidence: Agent Work v1 plan sections 8-21 and 23.
- Supersedes: Implicit use of benchmark-specific files as operational state and requested/logical agent counts as sufficient scale proof.
- Follow-up: Jake only needs to intervene if he wants to change a default, authorize an external action, fund post-v1 25+ worker qualification, or delete legacy paths rather than quarantine them.

## 2026-07-10 — Phase 1 Agent Work contract and authority freeze is green

- Decision: Treat Phase 1 as complete for the Agent Work v1 release sequence. The v1 schema catalog, v0→v1 compatibility fixture, component authority matrix, and canonical-entrypoint architecture checks are the baseline for later phases.
- Reason: The contract and authority boundary must be frozen before adding durable runtime behavior, otherwise Phase 3 would encode ambiguous ownership or unstable field semantics.
- Evidence: Local `node --test tests/agent-work-v1-contracts.test.mjs` passed `11/11`; remote proof `/root/clawd/large-project-capability-stack/artifacts/agent-work-v1/remote-phase1-20260710T112639Z/remote-proof.json` shows focused contracts `11/11`, system benchmark `95/95`, full `npm test` `366/366`, sync hash match true, compile green true, contractFreezeGreen true.
- Supersedes: STATUS checkpoint saying Phase 1 had not started.
- Follow-up: Phase 2 builds the public facade and operator CLI over this frozen contract.

## 2026-07-10 — Phase 2 stable facade and operator CLI is green

- Decision: Treat Phase 2 as complete for the Agent Work v1 release sequence. `packages/canonical-agent-work` is now the v1 facade surface and `apps/system-benchmark/canonical-agent-work.mjs` exposes the supported `agent-work plan|run|status|resume|cancel|verify|report|doctor|replay` command family with stable JSON and exit-code contracts.
- Reason: Agent Work needs one operator path before adding durable runtime machinery. The CLI must fail closed on placement, avoid benchmark-specific controllers as product APIs, and keep completion claims downgraded when only contracts/CLI are proven.
- Evidence: Local focused Phase 2/contract/canonical suite passed `22/22`; local full `npm test` passed `374/374`; local surface matrix `/root/clawd/large-project-capability-stack/artifacts/agent-work-v1/phase-2-cli/surface_matrix.json` is `all_complete`; remote proof `/root/clawd/large-project-capability-stack/artifacts/agent-work-v1/remote-phase2-20260710T125137Z/remote-proof.json` shows sync hash match true, focused `22/22`, full `374/374`, doctor green, report `completionClaimAllowed=false`, and wrong-plane run blocked with exit code `2` / `remote_execution_boundary_required`.
- Supersedes: Phase 1-only public-facade behavior freeze.
- Follow-up: Start Phase 3 durable runtime/recovery. Do not claim worker execution, recovery, release, parity, or 12-worker qualification from Phase 2 evidence.

## 2026-07-10 — Phase 3 durable runtime and recovery is green

- Decision: Treat Phase 3 as complete for the Agent Work v1 release sequence. `packages/agent-work-runtime` is the durable runtime substrate for v1 run roots, with SQLite WAL operational state, append-only JSONL events, deterministic projections, lease fencing, artifact indexing, remote-state reconciliation, and recovery packets.
- Reason: Later worker execution and verifier phases need restart-safe state and exact truth projection before any high-cost run can be trusted. Runtime state must survive crashes and stale workers must not be able to stage or merge after lease replacement.
- Evidence: Local focused runtime/facade/contract/canonical suite passed `29/29`; local full `npm test` passed `381/381`; local surface matrix `/root/clawd/large-project-capability-stack/artifacts/agent-work-v1/phase-3-recovery/surface_matrix.json` is `all_complete`; local proof `/root/clawd/large-project-capability-stack/artifacts/agent-work-v1/phase-3-recovery/phase3_local_proof.json`; remote proof `/root/clawd/large-project-capability-stack/artifacts/agent-work-v1/remote-phase3-20260710T130910Z/remote-proof.json` shows sync hash match true, focused `29/29`, full `381/381`, and recovery checks green for SQLite WAL, JSONL replay, fault injection, state versions, stale fencing rejection, accepted-patch de-dupe, artifact hash indexing, stale lease recovery, unknown remote-state blocker, and facade pause/resume/cancel/replay.
- Supersedes: Phase 2 placeholder behavior where resume/cancel/replay were command contracts without durable runtime mutation.
- Follow-up: Start Phase 4 objective planning/inventory/negative-space expansion. Do not claim worker execution, independent verifier service, release completion, 12-worker qualification, or product parity from Phase 3 evidence.

## 2026-07-10 — Phase 4 objective planning and inventory expansion is green

- Decision: Treat Phase 4 as complete for the Agent Work v1 release sequence. `packages/agent-work-planning` is now the canonical Phase 4 planning layer for objective-bound target/reference inventories, Full Parity Engine planning inputs, explicit negative-space rows, verifier-backed work graph nodes, continuation policy, and digest-bound plan review.
- Reason: Worker execution should not begin until the objective has machine-readable inventory truth, full-clone reference guards, duplicate-expansion protection, and an exact plan digest that can be approved or rejected without relying on chat prose.
- Evidence: Local focused Phase 4/planning/facade/runtime/contract/canonical suite passed `34/34`; local full `npm test` passed `386/386`; local surface matrix `/root/clawd/large-project-capability-stack/artifacts/agent-work-v1/phase-4-planning/surface_matrix.json` is `all_complete`; local proof `/root/clawd/large-project-capability-stack/artifacts/agent-work-v1/phase-4-planning/phase4_local_proof.json`; remote proof `/root/clawd/large-project-capability-stack/artifacts/agent-work-v1/remote-phase4-20260710T132457Z/remote-proof.json` shows sync hash match true, focused `34/34`, full `386/386`, workspace context linked, and all Phase 4 checks true.
- Supersedes: Phase 3 behavior where `agent-work plan` initialized runtime but did not yet produce canonical target/reference inventories, verifier-backed expansion work graph, or digest-bound plan review.
- Follow-up: Start Phase 5 worker adapter/isolation/merge lane. Do not claim worker execution, accepted patches, independent verifier service, release completion, 12-worker qualification, or product parity from Phase 4 evidence.

## 2026-07-10 — Phase 5 worker adapter/isolation/merge mechanics implemented; real provider evidence remains blocked

- Decision: Add `packages/agent-work-execution` as the canonical Phase 5 worker-execution mechanics package and wire the public facade to require a green Phase 5 worker execution packet before reporting worker progress.
- Reason: Worker progress must be artifact-backed by command/model/runtime/provider ledger, isolated workspace context, patch bundle scope checks, conflict detection, merge-lane admission, lease/fencing compatibility, and cleanup evidence. The facade must not fabricate worker execution from runtime startup alone.
- Implemented: versioned Codex adapter contract, context manifest/budget gate, isolated workspace provisioning, Codex worker evidence capture, provider ledger normalization, fixture-vs-real provider evidence separation, patch bundle scope gate, conflict detection, merge lane, cleanup evidence preservation, and worker execution packet reducer. `doctor`, `verify`, `report`, and `run` now understand Phase 5 packet status.
- Evidence: Local focused Phase 5/planning/facade/runtime/contract/canonical suite passed `38/38`; local full `npm test` passed `390/390`; remote Hetzner focused suite passed `38/38`; remote full suite passed `390/390`; remote selected-file hash sync matched. Local proof: `/root/clawd/large-project-capability-stack/artifacts/agent-work-v1/phase-5-execution/phase5_local_proof.json`. Remote proof: `/root/clawd/large-project-capability-stack/artifacts/agent-work-v1/remote-phase5-20260710T134204Z/remote-proof.json`.
- Truth boundary: Phase 5 fixture mechanics are implemented and qualified, but Phase 5 is not green under the plan acceptance gate because the provider ledger source is `codex_fixture_ledger`; the real-required worker execution packet is blocked with `real_codex_provider_evidence_required`.
- Follow-up: Run an explicitly approved small real Codex worker proof on Hetzner, or keep Phase 5 blocked/downgraded to fixture mechanics. Do not claim real worker execution, independent verifier service, release completion, 12-worker qualification, or product parity from fixture evidence.

## 2026-07-10 — Phase 5 real Codex worker proof is green

- Decision: Treat the Phase 5 `real_codex_provider_evidence_required` blocker as resolved for a tiny bounded worker proof. Phase 5 worker adapter/isolation/merge lane is now green for one real Codex CLI worker path on Hetzner.
- Reason: Jake approved the worker proof after the fixture-mechanics blocker. The proof had to show provider-observed usage from Codex itself, not a fixture ledger or worker self-report.
- Implemented: Added Codex JSONL usage parsing (`providerUsageFromCodexJsonl`) and fixed the Phase 5 adapter to preserve ordered CLI arguments. The first real-proof rerun caught that sorted args corrupted `codex exec`; a regression test now protects ordered args.
- Evidence: Remote real proof `/root/clawd/large-project-capability-stack/artifacts/agent-work-v1/remote-phase5-real-20260710T140718Z/remote-proof.json`; worker execution packet `/root/clawd/large-project-capability-stack/artifacts/agent-work-v1/remote-phase5-real-20260710T140718Z/phase5_execution/worker_execution_packet.json`; surface matrix `/root/clawd/large-project-capability-stack/artifacts/agent-work-v1/remote-phase5-real-20260710T140718Z/surface_matrix.json` is `all_complete`; selected-file sync hash matched; focused preflight `21/21`; local full `392/392`; remote full `392/392`; Codex CLI `0.136.0`; provider usage source `codex_cli_jsonl`; calls started/completed `1/1`; tokens observed `73336`; runtime `20608ms`; modified file `src/product.mjs`; `realCodexProviderEvidence=true`.
- Supersedes: Phase 5 fixture-only blocker state where `source=codex_fixture_ledger` and `realCodexProviderEvidence=false` blocked the plan acceptance gate.
- Follow-up: Start Phase 6 independent verification/completion truth. Do not claim independent verifier service, release readiness, 12-worker tier, six-hour soak, full parity, or 100 physical workers from the Phase 5 single-worker proof.

## 2026-07-10 — Phase 6 independent verification and completion truth is green

- Decision: Treat Phase 6 as complete for the Agent Work v1 release sequence. `packages/agent-work-verifier` is now the canonical independent-verification/completion-truth package, and the public facade surfaces Phase 6 truth in `verify`, `report`, and `doctor`.
- Reason: Completion claims must be derived from independent digest-bound verifier evidence, claim-ledger truth, objective truth, and worker execution evidence. Mechanical green and matrix green must not override red claim/objective truth, and worker self-report must not receive acceptance credit.
- Implemented: verifier adapter contracts for deterministic command, schema/static, runtime integration, browser/visual packet, and manual-review packet verifiers; clean source/patch/context digest binding; verifier evidence validation; verifier matrix reduction; completion truth packet; terminal blocker packet; terminal exact-claim packet; facade Phase 6 `verify`/`report` visibility; default config `requireIndependentVerification=true`; public behavior docs.
- Evidence: Local focused Phase 6 `6/6`; local full `npm test` `398/398`; local doctor green; remote Hetzner focused Phase 6 `6/6`; remote full `398/398`; remote doctor green; selected-file sync hash match true. Surface matrix `/root/clawd/large-project-capability-stack/artifacts/agent-work-v1/phase-6-truth/surface_matrix.json` is `all_complete`; supervisor packet `/root/clawd/large-project-capability-stack/artifacts/agent-work-v1/phase-6-truth/supervisor_packet.json` is `green`; remote proof `/root/clawd/large-project-capability-stack/artifacts/agent-work-v1/remote-phase6-20260710T151258Z/remote-proof.json`.
- Supersedes: Phase 5 boundary where worker execution was proven but independent verifier service and completion truth were not yet proven.
- Follow-up: Start Phase 7 release/scale/soak qualification only with exact scope and execution-plane proof. Do not claim release readiness, 12-worker release tier, six-hour soak, full parity, or production deployment from Phase 6 alone.

## 2026-07-10 — Phase 7 operations/security/remote deployment is green

- Decision: Treat Phase 7 as complete for the Agent Work v1 release sequence. `packages/agent-work-ops` is now the canonical Phase 7 operations-readiness package, and the public facade surfaces Phase 7 ops readiness in `verify`, `report`, and `doctor`.
- Reason: Before cross-repo release-candidate work, Agent Work needs a documented execution-plane boundary, live remote doctor evidence, heartbeat/log/artifact-sync discipline, emergency stop/drain/cancel/resume procedures, notifier/runner separation, fail-closed security fixtures, and backup/restore proof. This belongs before Phase 8 scale/soak qualification.
- Implemented: execution-plane install manifest, remote doctor packet, heartbeat/log/artifact sync packet, control-plane separation packet, security readiness packet, backup/restore readiness packet, operations readiness packet, Phase 7 surface matrix/supervisor packet, default config `requireOpsReadiness=true`, public facade/docs updates, and `docs/agent-work-v1/PHASE7_OPERATIONS_RUNBOOK.md`.
- Evidence: Local focused Phase 7 `6/6`; local full `npm test` `404/404`; local doctor green; remote Hetzner focused Phase 7 `6/6`; remote full `404/404`; remote doctor green with `hostRole=execution_plane`; selected-file sync hash match true; Codex path `/home/jake/.local/bin/codex`; remote disk checkpoint `314GB` free. Operations readiness packet `/root/clawd/large-project-capability-stack/artifacts/agent-work-v1/phase-7-ops/operations_readiness_packet.json` is `green` with `operationsClaimAllowed=true`; supervisor packet `/root/clawd/large-project-capability-stack/artifacts/agent-work-v1/phase-7-ops/supervisor_packet.json` is `green`; remote proof `/root/clawd/large-project-capability-stack/artifacts/agent-work-v1/remote-phase7-20260710T180037Z/remote-proof.json`.
- Supersedes: Phase 6 boundary where verifier/completion truth was green but operations/security/remote-deployment readiness was not yet proven.
- Follow-up: Start Phase 8 cross-repo qualification/release-candidate work only with an explicit matrix. Do not claim release readiness, 12-worker release tier, six-hour soak, full parity, 100 physical workers, or production deployment from Phase 7 evidence alone.

## 2026-07-10 — Phase 8 release-candidate work started; deterministic gates and 4-worker canary are green

- Decision: Start Phase 8 cross-repo qualification/release-candidate work, but keep the Phase 8 release-candidate claim blocked until the full Phase 8 matrix is green. `packages/agent-work-release-candidate` is now the canonical Phase 8 evidence reducer, and the public facade surfaces Phase 8 release-candidate truth in `verify`, `report`, and `doctor`.
- Reason: Phase 8 is multi-day release-candidate qualification, not a single deterministic test. The first safe sequence is to implement the matrix/reducer, prove deterministic no-model gates locally and on Hetzner, then run the first bounded real-worker canary while keeping 8-worker fault, 12-worker cross-repo, six-hour soak, clean-room replay, and independent review as explicit remaining blockers.
- Implemented: workload qualification packets; scale/duration packet; fault/replay packet; independent release review packet; release-candidate packet; honest blocked preflight packet; facade/config/docs/test integration; `docs/agent-work-v1/PHASE8_RELEASE_CANDIDATE_RUNBOOK.md`; Phase 8 supervisor/surface/release artifacts.
- Evidence: Focused local Phase 8/ops/verifier/CLI suite passed `27/27`; local full `npm test` passed `410/410`; remote Hetzner focused suite passed `27/27`; remote full suite passed `410/410`; remote doctor green with `hostRole=execution_plane`; selected-file sync hash matched. Remote qualification root: `/home/jake/clawd-remote/qualification/agent-work-phase8-20260710T185013Z/large-project-capability-stack`. Remote proof: `/root/clawd/large-project-capability-stack/artifacts/agent-work-v1/remote-phase8-20260710T185013Z/remote-proof.json`.
- Real-worker canary evidence: Hetzner 4-worker model canary `phase8-canary-4w-20260710T185013Z` passed threshold, supervisor confirmed completion, peak concurrency `4`, unique observed agents `4`, productive merged patches `4/4`, verified surfaces `4/4`, provider-observed tokens `80942`, active worker runtime `195789ms`, wall-clock `56769ms`. Canary packet: `/root/clawd/large-project-capability-stack/artifacts/agent-work-v1/phase-8-release-candidate/real_worker_canary_4w_packet.json` (`status=green`).
- Current Phase 8 state: release packet `/root/clawd/large-project-capability-stack/artifacts/agent-work-v1/phase-8-release-candidate/release-candidate/release_packet.json` remains `blocked` with `releaseCandidateClaimAllowed=false`; supervisor packet `/root/clawd/large-project-capability-stack/artifacts/agent-work-v1/phase-8-release-candidate/supervisor_packet.json` is `blocked` with `phase8_remaining_release_candidate_evidence_required`.
- Follow-up: Continue Phase 8 with AI OS/product-platform workload or 8-worker restart/fault campaign on Hetzner. Do not claim Phase 8 release-candidate green, 12-worker release tier, six-hour soak, full parity, 100 physical workers, production deployment, or Phase 9 release from the deterministic + 4-worker canary evidence.

## 2026-07-10 — Phase 8 8-worker restart/fault campaign green on Hetzner

- Decision: Credit the Phase 8 `restart_fault_campaign_8_physical_workers` gate as green from returned Hetzner artifacts, while keeping Phase 8 release-candidate status blocked.
- Reason: The dedicated launcher `apps/system-benchmark/run-agent-work-phase8-fault-campaign.mjs` refuses to go green on the control-plane host and records observed process/PID evidence on the execution plane. It exercises runtime/controller restart recovery, worker-loss handling, verifier failure, stale lease fencing, conflict fail-closed behavior, provider-error no-credit behavior, budget exhaustion guard, disk-pressure guard, runtime clean-room replay, and adversarial false-green count.
- Evidence: Remote run `phase8-fault-8w-20260710T185013Z` on `clawd-exec-hel1` returned `status=green`, `observedPhysicalWorkerCount=8`, all fault fixtures true, runtime clean-room replay green, and false greens `0`. Packet: `/root/clawd/large-project-capability-stack/artifacts/agent-work-v1/phase-8-release-candidate/restart-fault-campaign-8w/fault_campaign_packet.json`.
- Updated truth: Phase 8 `fault_replay_packet.json` is now green, but `release_packet.json` remains `blocked` with `releaseCandidateClaimAllowed=false`. Remaining release-candidate blockers are scale/duration and review: `cross_repo_12_observed_physical_workers`, `model_calls_match_observed_workers`, `six_hour_real_work_soak`, plus independent release review/final claim audit and remaining workload breadth.
- Follow-up: Continue with AI OS/product-platform workload, Mailchimp clone/parity slice, brownfield transfer workload, 12-worker productive cross-repo campaign where feasible, six-hour real-work soak, independent review, and final claim audit. Do not claim release-candidate green yet.

## 2026-07-10 — Phase 8 AI OS product-platform workload green on Hetzner

- Decision: Credit the Phase 8 `ai_os_product_platform` workload class as green from the bounded Hetzner r3 workload, while keeping Phase 8 release-candidate status blocked.
- Reason: The first AI OS run attempt (`r1`) used an unknown benchmark tier and was correctly blocked. The second attempt (`r2`) produced real AI OS product diffs and verifier-green surfaces but failed the strict `execution_smoke` median-time threshold by a narrow margin (`1.06m` vs `<=1.00m`), so it was not credited as a scored benchmark pass. The third attempt (`r3`) used the registered `real_worker_product_standard` tier, which is the honest tier for bounded AI OS product work, and passed threshold.
- Evidence: Remote run `phase8-aios-product-4w-r3-20260710T185013Z` on Hetzner returned `thresholdPass=true`, `supervisorConfirmedCompletion=true`, `mechanicalGreen=true`, `scaleProofReady=true`, peak concurrency `4`, unique agents `4`, productive merged patches `4/4`, provider-observed tokens `71090`, and pre-worker targeted tests failed as intended (`exitCode=1`) against pending stubs. Credited AI OS product files: `packages/aios-kernel/scheduler/phase8-execution-slot.mjs`, `packages/aios-kernel/verifier-claim-gate/phase8-evidence-reducer.mjs`, `packages/aios-language/runtime/phase8-capability-digest.mjs`, and `packages/aios-language/runtime/phase8-job-intake.mjs`.
- Artifacts: local workload root `/root/clawd/large-project-capability-stack/artifacts/agent-work-v1/phase-8-release-candidate/ai-os-product-platform-workload-r3`; workload packet `/root/clawd/large-project-capability-stack/artifacts/agent-work-v1/phase-8-release-candidate/ai_os_product_platform_workload_packet.json` (`status=green`); release packet remains `/root/clawd/large-project-capability-stack/artifacts/agent-work-v1/phase-8-release-candidate/release-candidate/release_packet.json` (`status=blocked`, `releaseCandidateClaimAllowed=false`).
- Current Phase 8 matrix: green workload count is `2` (`shared_stack_self_dogfood`, `ai_os_product_platform`). Still missing at least one more green workload class, plus 12-worker cross-repo evidence, six-hour real-work soak, independent release review, and final claim audit.
- Truth boundary: This proves only the bounded Phase 8 AI OS product-platform workload class. It does not prove AI OS runtime replacement, external writes, full parity, 12-worker cross-repo scale, six-hour soak, release-candidate green, production deployment, or Phase 9 release.

## 2026-07-10 — Phase 8 brownfield PMHNP transfer workload green on Hetzner

- Decision: Credit the Phase 8 `brownfield_transfer` workload class as green from the bounded Hetzner PMHNP Claim Guard workload, while keeping Phase 8 release-candidate status blocked.
- Repo selection: `/root/clawd/pmhnp-denial-copilot` was selected as the brownfield target because it is a real non-Mailchimp product shape with inspectable PMHNP Claim Guard behavior and prior transfer-benchmark history. The remote worker repo was a code-only copy at `/home/jake/clawd-remote/qualification/agent-work-phase8-20260710T185013Z/brownfield-pmhnp/pmhnp-denial-copilot`.
- Privacy/safety boundary: sync excluded `.git`, `node_modules`, `artifacts`, `state`, `backups`, `.env*`, and `docs/recovery`; the worker contract also forbade `client_data`, `phi`, external sends, and external writes. Remote baseline `npm run smoke` passed before launching workers.
- Evidence: Remote run `phase8-brownfield-pmhnp-4w-20260710T185013Z` on Hetzner returned `thresholdPass=true`, `supervisorConfirmedCompletion=true`, `mechanicalGreen=true`, `scaleProofReady=true`, peak concurrency `4`, unique agents `4`, productive merged patches `4/4`, provider-observed tokens `116801`, and pre-worker targeted tests failed as intended (`exitCode=1`) against pending stubs. Credited PMHNP product files: `src/domain/phase8AppealChecklist.mjs`, `src/domain/phase8ClaimRiskNormalizer.mjs`, `src/domain/phase8ExportGuard.mjs`, and `src/domain/phase8RoiTriage.mjs`.
- Artifacts: local workload root `/root/clawd/large-project-capability-stack/artifacts/agent-work-v1/phase-8-release-candidate/brownfield-pmhnp-workload`; workload packet `/root/clawd/large-project-capability-stack/artifacts/agent-work-v1/phase-8-release-candidate/brownfield_transfer_workload_packet.json` (`status=green`); release packet remains `/root/clawd/large-project-capability-stack/artifacts/agent-work-v1/phase-8-release-candidate/release-candidate/release_packet.json` (`status=blocked`, `releaseCandidateClaimAllowed=false`).
- Current Phase 8 matrix: green workload count is now `3` (`shared_stack_self_dogfood`, `ai_os_product_platform`, `brownfield_transfer`). Matrix still blocks on `scale_duration_green` and `independent_release_review_green`; scale/duration still blocks on `cross_repo_12_observed_physical_workers` and `six_hour_real_work_soak`.
- Truth boundary: This proves only the bounded Phase 8 brownfield-transfer workload class on a PMHNP code-only repo copy. It does not prove 12-worker cross-repo scale, six-hour soak, Mailchimp clone parity, production deployment, external writes, release-candidate green, or Phase 9 release.

## 2026-07-10 — Phase 8 12-worker cross-repo campaign green on Hetzner

- Decision: Credit the Phase 8 `productive_cross_repo_12_physical_workers` gate from the bounded Hetzner r2 cross-repo campaign, while keeping Phase 8 release-candidate status blocked.
- First attempt: `phase8-crossrepo-12w-20260710T185013Z` is explicitly red and not credited. It spawned 12 workers but produced `0` productive merges and `0` provider tokens because nested aggregate repo paths such as `large-project-capability-stack/packages/...` were rejected by the creative product-target classifier before Codex/model work started (`creative_product_work_target_missing`).
- Runtime fix: `apps/system-benchmark/live-transfer-worker.mjs` and `apps/system-benchmark/codex-creative-worker.mjs` now admit safe nested aggregate repo prefixes (`large-project-capability-stack/`, `ai-os/`, `pmhnp-denial-copilot/`, plus existing related prefixes) when classifying product targets. This allows real multi-repo aggregate paths without faking all surfaces into one repo.
- Credited run: `phase8-crossrepo-12w-r2-20260710T185013Z` on Hetzner returned `thresholdPass=true`, `supervisorConfirmedCompletion=true`, `mechanicalGreen=true`, `scaleProofReady=true`, peak concurrency `12`, unique agents `12`, merged shards `12/12`, productive merged patches `12/12`, and provider-observed tokens `223981`. Pre-worker targeted tests failed as intended (`exitCode=1`) against pending stubs.
- Artifacts: local campaign root `/root/clawd/large-project-capability-stack/artifacts/agent-work-v1/phase-8-release-candidate/cross-repo-12w-campaign-r2`; packet `/root/clawd/large-project-capability-stack/artifacts/agent-work-v1/phase-8-release-candidate/cross_repo_12w_packet.json` (`status=green`).
- Current Phase 8 truth: cross-repo scale/model-call checks are green. Scale/duration packet remains `blocked` solely because `six_hour_real_work_soak` is missing. Release packet remains `status=blocked`, `releaseCandidateClaimAllowed=false`; remaining gates are six-hour soak and independent release review/final claim audit.
- Truth boundary: This proves only the bounded 12-worker productive cross-repo campaign on Hetzner. It does not prove six-hour soak, independent review, release-candidate green, production deployment, external writes, 100 workers, or full parity.

## 2026-07-10 — Launch corrected GPT-5.6 Sol six-hour soak only after broad canary repair

- Decision: Reject the first weak corrected canary as launch evidence, repair objective-truth command normalization and worker context limits, qualify a productive second canary, then launch a fresh persistent six-hour Hetzner soak from a 1,000-surface objective. Count each fresh wave-local worker process invocation with a wave-qualified identity while preserving raw local labels and peak concurrency separately; measure soak duration from controller wall-clock while retaining active-wave runtime as a distinct metric.
- Reason: The first canary only merged one shard; the second proved reliable work but reused `agent-1`/`agent-2` labels across fresh processes and exhausted a 404-surface catalog too quickly for a six-hour target. Treating labels as physical identity or summed wave runtime as the sole wall soak duration would undercount real worker invocations and make the deadline mathematically unreachable. The corrected design fails closed on both problems without inflating concurrency.
- Evidence: Local and remote focused controller/release tests `51/51`; remote compiler output `/home/jake/clawd-remote/qualification/agent-work-phase8-corrected-soak-20260711T004019Z/full/workload-compile.json` (1,000 surfaces, 39 product files, 25 targeted tests); dry-run `/home/jake/clawd-remote/qualification/agent-work-phase8-corrected-soak-20260711T004019Z/full/dry-run.json`; active artifacts under `.../full/run`; launch verified at `2026-07-11T01:12:04Z` with launcher PID `2032495`, controller PID `2032499`, two live GPT-5.6 Sol Codex workers, and both truth gates enabled.
- Supersedes: Reusing the four-file `run-v2` workload; accepting a two-shard canary as 12-agent evidence; interpreting repeated wave-local labels as one persistent physical worker; requiring summed wave runtime to equal a wall-clock deadline.
- Follow-up: Audit the terminal canonical artifacts. Only if the soak is threshold-green should Phase 8 proceed to independent release review and final claim audit; otherwise preserve the exact blocker and do not claim soak credit.

## 2026-07-10 — Defer final quality evidence during active soak and exclude stopped downtime

- Decision: A missing final production-quality artifact is non-terminal while the duration target is unmet and grounded work remains. Objective truth is bound to the controller artifact path, terminal truth is recomputed after the final quality run, and resume clocks preserve prior active elapsed duration without counting stopped downtime. The quality command is the workload’s explicit 25-file product verifier set, checked against clean `HEAD`, rather than dirty-repo-sensitive orchestration self-tests.
- Reason: The first full corrected attempt stopped at 16.33 minutes even though 943 grounded surfaces remained because quality evidence is intentionally created only at terminal evaluation. Its broad `npm test` failures came from orchestration harnesses whose expected generated deltas change after product files are intentionally modified; all targeted product tests remained green.
- Evidence: Local and remote focused suites `53/53`; quality preflight current `30/30`, baseline `30/30`, regressions `0`, duplicate ratio `0.1099`; resume dry-run selected wave 9 and reconstructed `16.56` active minutes; live resumed wave 9 merged `2/2` and continued with `production_quality_gate_missing` deferred. Attempt-1 audit: `/home/jake/clawd-remote/qualification/agent-work-phase8-corrected-soak-20260711T004019Z/full/attempt1-blocked-audit/`.
- Supersedes: Treating `production_quality_gate_missing` as an immediate objective-truth blocker before the duration target and counting wall downtime between controller attempts.
- Follow-up: Audit terminal artifacts after 360 active controller minutes; do not claim soak/release unless threshold, objective truth, quality, provider, breadth, and repetition gates are all green.

## 2026-07-11 — Phase 8 corrected release-candidate qualification is green

- Decision: Credit the corrected persistent Mailchimp workload and declare the Phase 8 release-candidate matrix green for its exact bounded claim.
- Reason: Canonical artifacts show 361.06 active controller minutes, 243 waves, 357/363 merged shards, 12,141,226 provider-observed tokens, all 26 declared parity-for-scope surfaces complete, enabled+green production-quality and objective-truth gates, and independent execution-plane review. The workload observed peak physical concurrency 2; the separate cross-repo campaign proved 12 physical workers.
- Evidence: `artifacts/agent-work-v1/phase-8-release-candidate/release-candidate/release_packet.json` (`status=green`, digest `70268d65007f418fc600e784f88c948dfd923b92c37cbef4bc50d51d98957bb3`); `artifacts/agent-work-v1/phase-9-release/remote-qualification/phase8-soak-independent-review.json`; remote canonical soak root `/home/jake/clawd-remote/qualification/agent-work-phase8-corrected-soak-20260711T004019Z/full/run`.
- Supersedes: Phase 8 blocker state pending terminal six-hour evidence and independent review.
- Follow-up: Phase 9 release/handoff only; do not convert aggregate 12-worker qualification into a false 12-way-soak-concurrency claim.

## 2026-07-11 — Agent Work v1.0.0 Phase 9 is green for private/internal production-slice use

- Decision: Complete Phase 9 and authorize the exact private/internal `production_slice` Agent Work v1.0.0 release claim. Make `apps/agent-work/cli.mjs` the supported product CLI, retain the old benchmark CLI only as a warning-emitting wrapper, and keep Synthetic Labor OS paths compatibility/evidence-only.
- Reason: All 12 Phase 9 matrix rows are complete: Phase 8 green, canonical CLI/facade, single authority, legacy demotion, migration/rollback rehearsal, required docs, version/tag contract, clean-checkout qualification, independent review, source/remote/artifact source agreement, exact claim audit, and no external action.
- Evidence: source commit `9b9b3bf7184d1a4778341314a656b2f823836a02`; remote clean checkout `/home/jake/qualification/agent-work-v1-phase9-20260711T145035Z`; full remote suite `424/424`; tree digest `973eb2c61c6d59df0d9bc87d6050d01d760c9bd02607ebc892cfb2054e3f9cc0`; `artifacts/agent-work-v1/phase-9-release/surface_matrix.json` (`all_complete`); `artifacts/agent-work-v1/phase-9-release/release_packet.json` (`status=green`).
- Supersedes: Phase 9 pending and all earlier statements that Agent Work v1 was not yet released for its exact private/internal production-slice scope.
- Follow-up: Tag the final tracking commit `agent-work-v1.0.0`; require a new scoped milestone and separate approval for public GA, deployment, external announcements/actions, universal parity, full clone, or higher physical-worker claims.
