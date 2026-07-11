# Agent Work v1 — Proof-Carrying Objective Orchestration Plan

## Plan metadata

- Project slug: `agent-work-orchestration-v1`
- Product name: `Agent Work`
- Plan owner: `Jake + Cortex`
- Created: `2026-07-10`
- Last updated: `2026-07-11`
- Status: `completed for v1.0.0 private/internal production_slice; maintenance`
- Fidelity target: `production_slice`
- Primary stop condition: `agent_work_v1_release_packet_green_or_blocker`
- Status file: `/root/clawd/large-project-capability-stack/STATUS.md`
- Decisions log: `/root/clawd/large-project-capability-stack/DECISIONS.md`
- Plan index entry: `/root/clawd/docs/PLAN_INDEX.md`
- Active implementation path: `/root/clawd/large-project-capability-stack`

## Planning lifecycle guard

- Keep this file strategic and executable: product position, architecture, implementation sequence, release gates, and truth boundaries.
- Keep volatile state, blockers, latest test results, and the next action in `STATUS.md`.
- Keep durable choices and supersession history in `DECISIONS.md`.
- Artifact plans and old benchmark recovery plans are evidence, not active roadmaps.
- Any meaningful scope or release-gate change must update this plan, `STATUS.md`, `DECISIONS.md`, and `docs/PLAN_INDEX.md` together.

## 1. Working name and target position

**Agent Work v1** is a proof-carrying objective orchestrator for long-horizon software work.

Target position:

> Cortex grounds the objective and supervises it. Agent Work turns that objective into a durable, dynamically expanding work program. Codex/model workers perform bounded implementation on an isolated execution plane. Independent verifiers—not the workers and not chat prose—decide what evidence survives. OpenClaw returns only an artifact-backed completion claim or a concrete blocker.

This is deliberately **not** positioned as:

- a new foundation model;
- a better generic coding agent than Codex;
- a chat-based “swarm” demo;
- a claim that multi-agent orchestration itself is novel;
- a 100-agent vanity benchmark;
- a replacement for OpenClaw, Cortex, Codex, git, CI, or project-specific tests.

The product wedge is the combination of:

1. objective grounding and explicit fidelity;
2. dynamic negative-space discovery instead of finite-checklist exhaustion;
3. restart-safe remote execution with real leases and fencing;
4. isolated worker changes and deterministic merge admission;
5. independent, proof-carrying verification;
6. exact claim downgrading when evidence is incomplete;
7. durable replay, audit, recovery, and operator control across long runs.

That combination is the part worth finishing and owning.

## 2. Decision summary

Finish the existing orchestration stack as one coherent **Agent Work v1** control plane rather than adding another orchestration framework.

The v1 architecture will:

- preserve Cortex/OpenClaw as the intent, memory, policy, approval, and reporting layer;
- use Codex first as the implementation worker through a replaceable worker-adapter contract;
- make `packages/canonical-agent-work` the stable public facade;
- reuse the existing DSL, decomposer, controller, scheduler, run-state, claim-ledger, and Full Parity Engine components behind that facade;
- use SQLite WAL for authoritative operational state and versioned JSON/JSONL artifacts for portable evidence and replay;
- run heavy work only on the Hetzner execution plane;
- qualify reliability and transfer before pursuing higher concurrency;
- release at a proven 12 physical-worker operating tier, with 25+ workers treated as post-v1 scale qualification rather than a launch requirement.

The prior Cortex/Codex consolidation plan is superseded by this release plan. Its completed SLOS quarantine work remains valid as **Phase 0 history** and its decisions remain in `DECISIONS.md`.

## 3. Objective

### Primary objective

Turn a user-grounded software objective into a durable program that can plan, execute, verify, recover, replan, and stop honestly without requiring Jake to manually shepherd every worker or infer truth from progress messages.

### Operator served

- Jake, as the owner/operator of Cortex/OpenClaw.
- Cortex, as the planning and supervision mind.
- Codex/model workers, which need narrow context, file ownership, budgets, and acceptance contracts.
- Independent verifiers, which need immutable inputs and machine-readable proof obligations.

### Desired user experience

Jake should be able to say what outcome he wants. Cortex should create or update an explicit objective contract and show any material ambiguity. Once admitted, Agent Work should:

1. inventory the target and the objective’s negative space;
2. produce a reviewable plan and budget;
3. run on the correct execution plane;
4. expose status without requiring log archaeology;
5. survive process and host interruptions;
6. keep expanding or repairing work while the objective remains red;
7. stop only with verified success, explicit cancellation, or a structured blocker;
8. return a compact report linked to replayable evidence.

### Success changes

Before v1, the repository contains powerful but fragmented orchestration mechanisms and benchmark runners. After v1, there is one stable operator path, one state model, one artifact contract, one truth hierarchy, one recovery procedure, and one release packet proving the whole path across dissimilar repositories.

## 4. Fidelity and scope

Fidelity target: `production platform v1`.

In scope:

- a stable CLI and library facade for plan/run/status/resume/cancel/verify/report/doctor;
- objective binding, fidelity binding, budgets, permissions, and stop conditions;
- automatic repository inventory plus pluggable reference inventory;
- negative-space and verifier-matrix generation;
- dependency-aware work graph generation and continuous expansion;
- durable run, wave, task, lease, worker, patch, verifier, budget, and claim state;
- Codex-first remote worker execution through an adapter interface;
- isolated git worktrees or equivalent isolated worker workspaces;
- patch admission, conflict handling, merge queue, rollback, and provenance;
- independent verifier execution with immutable evidence references;
- truth-layer separation and exact claim packets;
- crash recovery, stale-lease recovery, idempotency, and resume;
- operator status, health, event timeline, cancellation, and incident bundle;
- control-plane/execution-plane enforcement;
- secret redaction, command policy, path policy, resource limits, and external-action denial by default;
- cross-repo qualification and a release-candidate packet.

## 5. Non-goals

Out of scope for v1:

- building a model or a generic Codex replacement;
- supporting every model provider before Codex-first reliability is proven;
- a polished multi-tenant SaaS control plane;
- public marketplace, billing, or customer administration;
- arbitrary remote shell access from workers;
- autonomous external sends, deployments, purchases, or public actions;
- claiming full clone or full parity without an explicit reference inventory and green parity matrix;
- requiring 100 physical workers for release;
- treating token use, elapsed time, LOC, or agent count as completion evidence;
- deleting historical SLOS artifacts or proof records as part of v1.

Post-v1 possibilities:

- a provider-neutral worker marketplace;
- browser-worker and design-worker adapters;
- 25/45/100 physical-worker qualifications where real low-overlap work exists;
- multi-tenant service APIs and a dedicated web console;
- externally published benchmark and reliability reports.

## 6. Prior art and differentiation boundary

Prior-art decision: `extend_existing_and_differentiate_on_truth_and_operations`.

Multi-agent planning, delegation, subagents, worktrees, task graphs, and manager/worker systems already exist in products and frameworks including Codex, Claude Code agent teams, Cursor, Devin, Factory, LangGraph, Microsoft Agent Framework, Google ADK, Gas Town, and research systems from Anthropic and others.

Therefore:

- do not market ordinary delegation or parallelism as invention;
- do not rebuild worker cognition already supplied by frontier coding agents;
- do not chase novelty through a larger worker count;
- do compete on objective integrity, durable operations, recovery, independent verification, and honest claims.

A defensible Agent Work claim must be narrower:

> A self-hosted, proof-carrying orchestration control plane for long-running software objectives, with dynamic objective expansion, remote execution boundaries, restart-safe state, independent verification, and downgrade-safe completion claims.

## 7. Current asset inventory

Active shared-stack components to reuse:

| Capability | Existing component | v1 disposition |
|---|---|---|
| Cortex-to-run handoff | `packages/cortex-agent-work-adapter` | keep; make input boundary explicit |
| Human/AI-readable contract | `packages/agent-work-dsl` | keep; version and harden |
| Stable facade | `packages/canonical-agent-work` | promote to public API/CLI facade |
| Repo/objective decomposition | `packages/objective-surface-decomposer` | keep; connect to inventory adapters |
| Parity and negative-space truth | `packages/full-parity-engine` | keep; move from fixture/dry-run to runtime input |
| Scheduling and worker farm | `packages/multi-agent-orchestrator` | keep; hide behind runtime service boundaries |
| Autonomous continuation | `packages/orchestration-autonomy` | keep; consolidate policy decisions |
| Run truth reduction | `packages/orchestrator-run-state` | keep; make authoritative state projection |
| Claim evidence | `packages/proof-carrying-claim-ledger` | keep; require at merge/release gates |
| Learning evidence | `packages/orchestration-learning-ledger` | keep offline and verifier-gated |
| Historical job shell | `packages/synthetic-labor-os` | compatibility only, no new runtime primitives |
| Benchmark runners | `apps/system-benchmark/*` | convert to adapters/qualification, not product API |

Current baseline truth as of plan creation:

- canonical compilation and control-plane boundary checks exist;
- objective decomposition and objective expansion primitives exist;
- Full Parity Engine v0 can compute supplied inventories and emit a claim packet;
- worker farms, leases, patch admission, and run-state reducers exist;
- targeted tests for the core planning/truth path passed `62/62` on `2026-07-10`;
- the repository does **not** yet have a released, restart-qualified, end-to-end Agent Work v1 runtime;
- no new v1 release claim is allowed from the baseline tests alone.

## 8. Canonical architecture

```text
User / OpenClaw
    |
    v
Cortex objective grounding + approvals
    |
    v
Agent Work public facade
    |-- Objective Contract Binder
    |-- Inventory + Full Parity Engine
    |-- Work Graph Compiler
    |-- Admission / Budget / Policy Gate
    |
    v
Durable Supervisor (SQLite WAL + JSONL event log)
    |-- Scheduler + dependency graph
    |-- Lease/fencing manager
    |-- Budget governor
    |-- Recovery/replan engine
    |-- Artifact index
    |
    v
Remote Execution Adapter
    |-- Codex worker adapter (v1)
    |-- isolated worktree/workspace per task
    |-- resource and command policy
    |
    v
Patch Staging + Merge Queue
    |-- provenance checks
    |-- conflict detection
    |-- semantic/product admission
    |
    v
Independent Verification
    |-- deterministic tests
    |-- project acceptance checks
    |-- parity/negative-space recomputation
    |-- adversarial claim checks
    |
    v
Supervisor truth + claim packet
    |
    v
OpenClaw artifact-backed delivery
```

### Ownership boundaries

- **OpenClaw:** interaction, approval boundaries, notifications, reliable delivery.
- **Cortex:** grounding, memory, routing, plan formation, policy, supervision, final synthesis.
- **Agent Work:** objective contract, state machine, scheduling, budgets, artifacts, recovery, and claim assembly.
- **Codex workers:** bounded implementation only; workers cannot declare objective completion.
- **Independent verifiers:** acceptance and evidence production; verifiers cannot silently alter product code.
- **Full Parity Engine/project acceptance:** objective truth and negative-space truth.
- **Learning OS/learning ledger:** offline learning from completed evidence only; never controls a live run.

### Execution boundary

- Control plane: `/root/clawd` on the OpenClaw host.
- Execution plane: `jake@37.27.129.239:/home/jake/clawd-remote`.
- Local control-plane work is limited to planning, light deterministic tests, status, and artifact consumption.
- Heavy workers, browser-heavy checks, long tests, and repo-scale qualification run on Hetzner.
- A `remote_execution_required` contract must fail closed if launched on a control-plane host.

## 9. Public product surface

The supported v1 CLI will be one command family. Package-script aliases may remain, but they are not separate products.

```text
agent-work plan <objective|handoff> --out <run-root>
agent-work run <run-root> [--approve-plan <digest>]
agent-work status <run-root> [--json]
agent-work resume <run-root>
agent-work cancel <run-root> --reason <text>
agent-work verify <run-root>
agent-work report <run-root> [--format json|markdown]
agent-work doctor [--execution-plane]
agent-work replay <run-root> --verify-only
```

Required library facade:

```text
compileObjective()
admitRun()
startRun()
getRunStatus()
resumeRun()
cancelRun()
verifyRun()
buildCompletionPacket()
```

Rules:

- Stable public APIs live under `packages/canonical-agent-work`.
- Internal packages may remain separate, but callers do not compose them ad hoc.
- Every CLI command supports machine-readable JSON output and stable exit codes.
- Unsafe or ambiguous defaults fail closed with a structured blocker.
- Historical SLOS and benchmark commands remain compatibility/qualification paths only.

## 10. Core contracts and schemas

All v1 schemas must be versioned, validated before use, and represented in the artifact manifest.

### Input and planning artifacts

```text
objective_contract.json
permission_contract.json
budget_contract.json
reference_inventory.json
implementation_inventory.json
negative_space_inventory.json
parity_matrix.json
verifier_matrix.json
work_graph.json
plan_review_packet.json
admission_decision.json
```

### Runtime artifacts

```text
run.db                         # SQLite WAL operational state
run_events.jsonl               # append-only portable event stream
run_manifest.json
program_state.json
run_state_truth.json
budget_ledger.json
lease_ledger.json
worker_call_ledger.json
artifact_index.json
heartbeat.json
```

### Per-task artifacts

```text
tasks/<task-id>/assignment.json
tasks/<task-id>/context_manifest.json
tasks/<task-id>/worker_result.json
tasks/<task-id>/patch.bundle
tasks/<task-id>/diff_stat.json
tasks/<task-id>/provenance.json
tasks/<task-id>/verifier_results.json
tasks/<task-id>/claim_ledger.json
```

### Terminal artifacts

```text
supervisor_truth.json
claim_packet.json
completion_summary.json
blocker_report.json            # required when terminal red/blocked
incident_bundle.json           # required for infrastructure/runtime failure
release_packet.json            # required only for v1 qualification/release
artifact_manifest.json         # paths, hashes, schema versions
```

### Contract invariants

- Every mutable entity has a stable ID, state version, and idempotency key.
- Every state transition is append-only in `run_events.jsonl` and transactionally reflected in `run.db`.
- Every lease has a fencing token; stale workers cannot commit after lease replacement.
- Artifact references are content-hashed; missing or changed evidence invalidates dependent claims.
- Worker/model identity, command, start/end time, exit status, and provider-observed usage are recorded when available.
- No completion packet can be green while required artifacts are missing or contradictory.
- JSON artifacts remain replayable without requiring access to chat history.

## 11. State machines

### Run state

```text
draft
  -> compiled
  -> awaiting_plan_approval | admitted
  -> queued
  -> running
  -> verifying
  -> replanning -> running
  -> green | blocked | cancelled | failed
```

### Task state

```text
proposed
  -> ready
  -> leased
  -> running
  -> result_received
  -> staged
  -> verifying
  -> accepted | rejected | conflicted | retryable | blocked
```

### Terminal precedence

1. `cancelled` when an authorized cancellation is durably recorded.
2. `blocked` when objective progress cannot continue safely and a blocker report exists.
3. `failed` for unrecovered control-plane/runtime failure with an incident bundle.
4. `green` only when supervisor truth, required verifiers, claim ledger, and objective matrix agree.

Contradictions produce `blocked`, never optimistic completion.

### Recovery rules

- On startup, rebuild projections from the event log and compare them with SQLite state.
- Reconcile remote worker heartbeats before declaring a run stopped.
- Reclaim only expired leases and increment fencing tokens.
- Treat unknown worker outcomes as unresolved, not failed or successful.
- Re-run idempotent verification before re-running implementation.
- Never duplicate an accepted patch or spend model budget twice for the same idempotency key without an explicit retry event.

## 12. Objective planning and dynamic expansion

The planner must bind these fields before admission:

1. anchor and reply anchor, when present;
2. target repository/path;
3. fidelity: `prototype`, `production_slice`, `parity_for_scope`, or `full_clone`;
4. scope and explicit non-goals;
5. implementation surface;
6. stop condition;
7. permissions and prohibited actions;
8. time, token, monetary, worker, and compute budgets;
9. required evidence and verifiers;
10. execution placement.

Planning sequence:

1. inventory the active target path;
2. inventory the reference target when parity/clone fidelity requires one;
3. classify observed, estimated, missing, and unverifiable surfaces;
4. build the verifier matrix before worker launch;
5. build a dependency graph with file ownership and collision risk;
6. compute feasible physical concurrency from low-overlap ready work;
7. emit a plan-review packet with budget and claim boundary;
8. require approval only when policy or user preference requires it;
9. admit the run and create the durable state store.

Dynamic expansion rule:

- A finite queue becoming empty is not success.
- If the objective remains red, recompute target inventory, negative space, and verifier gaps.
- Expand only with executable, non-duplicate work units.
- If no executable work can be derived, emit a blocker/gap inventory.
- For full-clone objectives, exact objective credit is required; file-collision equivalence is only a scheduling optimization.

## 13. Scheduling, isolation, and merge policy

### Scheduler

- dependency-aware ready queue;
- collision-aware concurrency;
- priority based on objective gap reduction, blocker removal, and critical path;
- bounded retries by failure family;
- separate implementation, verification, repair, and release lanes;
- backpressure from merge queue, verifier queue, provider limits, and budget governor;
- no agent-count inflation when ready low-overlap work is smaller than requested concurrency.

### Worker isolation

Default: one ephemeral git worktree/workspace per task with a read-only source baseline and an explicit write allowlist.

Workers receive:

- objective excerpt;
- task contract;
- target files and allowed paths;
- architecture/context pack;
- acceptance checks;
- budget and timeout;
- prohibited actions;
- required result schema.

Workers do not receive:

- unrelated workspace secrets;
- unbounded repository history by default;
- permission to push, deploy, message, or mutate canonical state;
- authority to mark a task or run complete.

### Merge admission

1. worker result schema valid;
2. lease/fencing token current;
3. declared and observed file changes agree;
4. path and permission policy pass;
5. patch applies to the expected baseline;
6. product/semantic admission passes;
7. deterministic and project verifiers pass;
8. proof-carrying claim survives adversarial checks;
9. conflict policy chooses merge, rebase/repair, or reject;
10. accepted patch and provenance are content-hashed and durably recorded.

No worker writes directly to the canonical branch.

## 14. Verification and truth hierarchy

Truth layers must remain separate:

1. **Process truth:** the controller and workers actually ran.
2. **Mechanical truth:** required commands and schemas passed.
3. **Scale truth:** claimed physical workers/model calls are evidenced.
4. **Patch truth:** accepted changes survived merge admission.
5. **Surface truth:** declared product surfaces are implemented and verified.
6. **Objective truth:** the bound objective and negative-space matrix are green.
7. **Release truth:** source, artifacts, recovery tests, and release checks are durable.

Verifier independence rules:

- A worker may suggest tests but cannot be the sole verifier of its own completion.
- Verifiers run from a clean or staged integration context, not the worker’s mutable session.
- Test exit status alone is insufficient when the objective requires runtime, visual, persistence, integration, or parity evidence.
- Green is impossible if required verifier evidence is missing, stale, or points at a different source digest.
- A verifier may reject or downgrade; it may not silently broaden the objective.

Claim packet examples:

```text
allowed: bounded production slice verified
rejected: full parity
reason: 14 reference surfaces remain missing
```

```text
allowed: orchestration reliability qualification passed at 12 physical workers
rejected: 100-agent capability
reason: no provider-observed 100-worker qualification exists
```

## 15. Security and policy standard

Required v1 controls:

- deny external writes by default;
- explicit command allow/deny policy;
- path allowlists with traversal and symlink escape protection;
- redaction of tokens, environment secrets, and credentials in logs/artifacts;
- least-privilege SSH identity for execution workers;
- execution time, memory, process, output, and disk quotas;
- network policy declared per run;
- artifact integrity hashes;
- audit trail for approvals, cancellations, policy overrides, and retries;
- no dynamic execution of untrusted artifact instructions;
- worker output treated as untrusted input until schema and policy validation;
- emergency stop that prevents new leases and revokes active execution;
- cleanup that does not delete canonical source or evidence without explicit authorization.

Security acceptance includes malicious-path, symlink, command-injection, secret-leak, stale-worker, forged-result, and verifier-tampering fixtures.

## 16. Observability and operator experience

`agent-work status` must answer, without log archaeology:

- What objective and fidelity are bound?
- Where is it running?
- Is the remote execution plane alive?
- What phase is active?
- How many tasks are proposed/ready/running/accepted/rejected/blocked?
- What is the critical path?
- What budget has been consumed and remains?
- What changed in the product?
- Which verifiers are green/red/not run?
- What objective gaps remain?
- What is the exact next action?
- Is Jake needed now?

Operator artifacts:

- compact status JSON;
- human-readable Markdown report;
- chronological event timeline;
- budget and provider ledger;
- worker and verifier health summary;
- recovery recommendation;
- one-shot incident bundle.

Notifications should be sparse: plan decision needed, meaningful milestone, terminal green, terminal blocker, budget risk, or time-sensitive infrastructure failure. Repeated “still running” updates are not useful.

## 17. Surface matrix and ownership

| Surface | Primary implementation files | Owner role | Acceptance checks | Claim allowed when |
|---|---|---|---|---|
| Public facade and CLI | `packages/canonical-agent-work/`, `apps/agent-work/` | runtime/API implementer | CLI contract, exit codes, JSON snapshots | all supported commands use one facade |
| Objective/admission contracts | `packages/agent-work-dsl/`, `packages/cortex-agent-work-adapter/` | planner/compiler | schema, ambiguity, budget, permission tests | admitted objective is fully grounded |
| Inventory/parity truth | `packages/full-parity-engine/`, `packages/objective-surface-decomposer/` | objective-truth squad | golden inventories, gap and downgrade tests | reference/target/gaps reproducible |
| Durable state/event store | new `packages/agent-work-runtime/` | runtime/recovery squad | transaction, replay, migration, crash tests | restart reproduces authoritative state |
| Scheduling and leases | `packages/multi-agent-orchestrator/` plus runtime adapter | scheduler squad | dependency, fencing, backpressure tests | no stale/duplicate commit credit |
| Worker adapters | new `packages/agent-work-worker-adapters/` | execution squad | Codex fixture, process, timeout, usage ledger | real worker identity and output proven |
| Patch/merge admission | orchestrator + new runtime service | integration squad | baseline, conflict, rollback, provenance tests | accepted patch is clean and evidenced |
| Verifier service | new `packages/agent-work-verifier/` + project adapters | verifier squad | clean-context and tamper tests | verifier source digest matches patch |
| Run truth and claims | `packages/orchestrator-run-state/`, claim packages | truth squad | contradiction and downgrade tests | all truth layers agree |
| Operator/doctor/recovery | CLI + deployment scripts/config | operations squad | remote doctor, resume, cancel, incident tests | operator can diagnose and recover run |
| Qualification/release | `apps/system-benchmark/`, fixtures, release scripts | independent release reviewer | cross-repo matrix and release packet | every required release gate is evidenced |

Ownership rules:

- One squad owns a file area during a wave.
- Shared schema changes require runtime and verifier review.
- Workers may edit only leased product paths.
- Qualification code cannot override runtime truth.
- Docs/tests/harness-only changes receive no product-completion credit unless that is the declared surface.

## 18. Detailed implementation sequence

### Phase 0 — Consolidation and canonical-path selection (`complete prerequisite`)

Purpose:

- remove legacy default paths and choose Cortex → Agent Work → Codex → independent verifier as canonical.

Completed evidence:

- SLOS v1-v18 and direct wrappers recoverably quarantined;
- v19 compatibility-only and v20 mechanism-donor status documented;
- canonical execution path documented;
- targeted and full tests recorded in the prior plan status/decisions.

Remaining Phase 0 action:

- inventory any runtime behavior still reachable only through SLOS/benchmark entrypoints and assign it to a v1 phase before removing another path.

### Phase 1 — Freeze the v1 contract and baseline (`1-2 focused days`)

Tasks:

1. Write `agent-work.v1` schemas for objective, budget, permission, run manifest, event, task, lease, worker call, verifier result, state truth, blocker, and completion packet.
2. Create a compatibility map from current v0 fields to v1 fields.
3. Inventory duplicate state decisions across the objective controller, finite runner, SLOS, run-state reducer, and orchestration-autonomy package.
4. Declare one authority for each decision: admission, scheduling, retry, continuation, terminal truth, claim construction.
5. Capture current behavior with golden fixtures before refactoring.
6. Add architecture tests that reject new product entrypoints bypassing the canonical facade.

Acceptance checks:

- all schemas validate valid fixtures and reject malformed/unknown-critical fields;
- the authority matrix has no two components owning the same terminal decision;
- v0 compatibility fixtures compile without execution;
- targeted baseline tests remain green;
- no heavy execution occurs.

Exit artifact:

```text
artifacts/agent-work-v1/phase-1-contract/baseline_packet.json
```

### Phase 2 — Build the stable facade and operator CLI (`2-4 focused days`)

Tasks:

1. Promote `packages/canonical-agent-work` from a thin v0 wrapper to the v1 facade.
2. Implement the command family in Section 9.
3. Add stable exit-code and JSON-output contracts.
4. Add config resolution with explicit precedence: CLI → run config → workspace default; environment variables only for secrets/host facts.
5. Route old supported package scripts through the facade or label them compatibility-only.
6. Add `agent-work doctor` for local/control-plane checks.

Acceptance checks:

- plan/status/report/doctor work locally without model calls;
- `run` fails closed on the wrong execution plane;
- CLI snapshot tests cover success, blocked, cancelled, malformed input, and missing artifact cases;
- no supported command needs a benchmark-specific filename;
- direct legacy entrypoint use emits a clear compatibility warning.

Exit artifact:

```text
artifacts/agent-work-v1/phase-2-cli/cli_contract_packet.json
```

### Phase 3 — Durable runtime and recovery (`4-7 focused days`)

Tasks:

1. Add `packages/agent-work-runtime`.
2. Implement SQLite WAL schema and migrations.
3. Implement append-only JSONL events and deterministic projections.
4. Add idempotency keys, monotonic state versions, lease fencing, and transactional artifact indexing.
5. Implement startup reconciliation, stale-lease recovery, remote-heartbeat reconciliation, pause/resume, and cancellation.
6. Make `orchestrator-run-state` the terminal truth projector rather than an optional report helper.
7. Add fault injection at every state transition.

Acceptance checks:

- killing the supervisor at each injected point and restarting produces the same accepted-task and budget truth;
- an old worker with a stale fencing token cannot stage or merge;
- accepted patches are never duplicated after resume;
- unknown remote state blocks rather than fabricating completion;
- state can be rebuilt from portable events and artifact hashes;
- schema migration forward and backup/restore tests pass.

Exit artifact:

```text
artifacts/agent-work-v1/phase-3-recovery/recovery_qualification_packet.json
```

### Phase 4 — Objective planning, inventories, and continuous expansion (`4-7 focused days`)

Tasks:

1. Connect Cortex handoffs to the Full Parity Engine objective binder.
2. Implement automatic target-repository inventory adapters.
3. Implement pluggable reference adapters for repo/spec/API/route/test inventories; browser/visual reference remains optional unless declared.
4. Convert negative-space rows into verifier-backed work graph nodes.
5. Compute feasible concurrency from ready low-overlap work.
6. Add plan-review packets with estimated budget, risk, and claim boundary.
7. Recompute inventories after accepted waves.
8. Continue, repair, downgrade, or block through one authoritative continuation policy.

Acceptance checks:

- three dissimilar fixture repos produce deterministic inventories;
- missing routes, persistence, permissions, integrations, tests, and runtime roles appear as explicit gaps where applicable;
- an empty queue while objective-red causes executable expansion or a blocker;
- duplicate expansion work is rejected;
- a full-clone request cannot compile without a declared reference source and parity evidence requirements;
- plan digest approval binds the actual admitted plan.

Exit artifact:

```text
artifacts/agent-work-v1/phase-4-planning/planning_qualification_packet.json
```

### Phase 5 — Codex worker adapter, isolation, and merge lane (`4-7 focused days`)

Tasks:

1. Add a versioned worker-adapter interface and Codex implementation.
2. Provision ephemeral worktrees/workspaces on Hetzner.
3. Produce compact context manifests and enforce context/token budgets.
4. Record command/model/runtime/provider-usage evidence.
5. Stage patches as bundles; prohibit worker writes to canonical branches.
6. Add deterministic conflict detection, rebase/repair routing, and rollback.
7. Apply resource limits, timeout escalation, output caps, and cleanup.
8. Integrate merge admission with leases, provenance, semantic checks, and verifier requirements.

Acceptance checks:

- real Codex calls produce non-null command/model/runtime and provider-usage evidence;
- worker isolation prevents cross-task file contamination;
- conflicting patches are serialized or repaired, never silently overwritten;
- a timed-out or killed worker cannot merge later with a stale lease;
- canonical source changes only through the merge lane;
- cleanup preserves evidence and does not delete canonical source.

Exit artifact:

```text
artifacts/agent-work-v1/phase-5-execution/worker_execution_packet.json
```

### Phase 6 — Independent verification and completion truth (`3-6 focused days`)

Tasks:

1. Add `packages/agent-work-verifier` and a stable verifier-adapter interface.
2. Run verifiers in clean integration contexts bound to source/patch digests.
3. Support deterministic command, schema/static, runtime integration, browser/visual, and manual-review packet verifier types.
4. Connect verifier results to patch admission, parity recomputation, and proof-carrying claims.
5. Add adversarial claims and contradiction detection.
6. Implement final claim packet and blocker packet construction through the canonical facade.

Acceptance checks:

- forged/stale verifier evidence is rejected;
- worker self-report alone receives no acceptance credit;
- mechanical green cannot override red objective truth;
- matrix green plus failed claim ledger becomes contradiction-blocked;
- every terminal red state has a blocker/incident packet;
- every terminal green state has complete hashed evidence and exact allowed claims.

Exit artifact:

```text
artifacts/agent-work-v1/phase-6-truth/truth_qualification_packet.json
```

### Phase 7 — Operations, security, and remote deployment (`3-5 focused days`)

Tasks:

1. Package execution-plane install, config, system service/supervisor, and health checks.
2. Implement remote `doctor`, heartbeat, log rotation, artifact sync, and disk/budget alarms.
3. Add emergency stop, graceful drain, cancel, and resume procedures.
4. Add least-privilege SSH/runtime identity and secret-redaction checks.
5. Add backup/restore for operational state and release artifacts.
6. Keep notifications outside the heavy runner so failures can still be delivered.

Acceptance checks:

- clean execution-plane install and doctor pass from documented commands;
- service restart resumes a test run without duplicate acceptance;
- loss of notifier does not alter run truth;
- loss of runner still permits blocker notification;
- malicious path/command/secret fixtures fail closed;
- recovery runbook works from a fresh checkout plus artifact/state backup.

Exit artifact:

```text
artifacts/agent-work-v1/phase-7-ops/operations_readiness_packet.json
```

### Phase 8 — Cross-repo qualification and release candidate (`5-10 elapsed days`)

Qualification order:

1. deterministic no-model suite;
2. real-worker bounded canary at 2-4 physical workers;
3. restart/fault campaign at 8 physical workers;
4. productive cross-repo campaign at 12 physical workers;
5. six-hour unattended soak with real worker activity across multiple waves;
6. source sync, clean-room replay, release review, and claim audit.

Required workload classes:

- **Shared-stack self-dogfood:** a bounded real Agent Work product change.
- **AI OS/product-platform workload:** nontrivial product/runtime surface with project-specific verifiers.
- **Clone/parity workload:** a bounded Mailchimp slice with reference inventory and negative-space checks.
- **Low-overlap brownfield transfer:** PMHNP denial-copilot or another approved brownfield repo, with no client data or external actions in worker context.

Acceptance checks:

- all required workload classes produce real product diffs or an honest workload-specific blocker;
- 12 requested physical workers are matched by observed worker/model-call evidence where 12-way low-overlap work exists;
- controller restart, worker loss, verifier failure, stale lease, conflict, provider error, budget exhaustion, and disk-pressure fixtures are handled as specified;
- no false-green adversarial fixture passes;
- all accepted product changes have provenance and independent verifier evidence;
- clean-room replay reproduces terminal truth from source plus artifacts;
- the six-hour run includes positive implementation runtime and provider-observed usage across waves; verifier wait time is not credited as coding time;
- full repository tests and project-specific gates pass at the release source digest;
- release packet is independently reviewed.

Exit artifact:

```text
artifacts/agent-work-v1/release-candidate/release_packet.json
```

### Phase 9 — v1 release and legacy demotion (`2-4 focused days`)

Tasks:

1. Tag the v1 API/schema and write migration notes.
2. Publish operator, recovery, architecture, and extension documentation internally.
3. Route active internal orchestration through Agent Work v1.
4. Demote redundant benchmark/SLOS entrypoints to compatibility or quarantine only after reference audit.
5. Commit, push, and verify source and release artifacts from a clean checkout.
6. Write the exact allowed release claim and remaining limitations.

Acceptance checks:

- canonical command works from a clean checkout;
- no active default path bypasses the facade;
- migration and rollback are documented and tested;
- source commit, remote commit, and release artifact source digest agree;
- `agent_work_v1_release_packet_green_or_blocker` is satisfied.

Completion record (`2026-07-11`):

- source commit qualified: `9b9b3bf7184d1a4778341314a656b2f823836a02`;
- clean execution-plane checkout: `424/424` full tests green;
- Phase 8 release-candidate packet: `green`;
- Phase 9 surface matrix: `all_complete` (`12/12`);
- Phase 9 release packet: `green` for the exact private/internal `production_slice` claim;
- no public announcement or deployment performed;
- observed corrected-soak peak physical concurrency: `2`; the separate bounded cross-repo campaign proved the 12-physical-worker scale gate.

## 19. Qualification matrix

| Gate | Minimum evidence | Blocking failures |
|---|---|---|
| Unit/schema | all Agent Work v1 unit and schema tests green | any required test failure |
| Architecture | no active runtime bypass; dependency direction check | new second controller/product path |
| Security | malicious fixture suite green | path escape, secret leak, unauthorized command/write |
| Recovery | deterministic kill/restart matrix green | lost accepted work, duplicate merge, fake terminal state |
| Real worker | worker/model command, runtime, usage, result, patch evidence | deterministic worker standing in for claimed model work |
| Merge | conflicts, stale leases, rollback, provenance green | silent overwrite or unproven canonical change |
| Truth | adversarial contradiction/downgrade suite green | any false-green case |
| Transfer | four workload classes attempted; three must complete green and any fourth must have a non-generic blocker | framework only works on one shaped fixture |
| Duration | six-hour unattended run with real multi-wave worker activity | elapsed time from idle verifier/wait only |
| Scale | 12 observed physical workers on feasible low-overlap work | requested/logical count used as physical count |
| Replay | clean checkout + artifacts reproduces terminal claim | chat memory or mutable remote state required |
| Release | source/artifact digests, tests, docs, rollback, reviewer green | dirty/unpushed source or incomplete packet |

A workload-specific blocker does not automatically fail the whole release if the blocker proves an external constraint rather than a runtime defect. The independent release review must classify that distinction explicitly.

## 20. Reliability and performance standards

V1 release SLOs:

- **False-green tolerance:** `0` in the required adversarial qualification suite.
- **Lost accepted patches:** `0` across the restart/fault matrix.
- **Duplicate accepted patches after resume:** `0`.
- **Terminal artifact completeness:** `100%` of terminal runs have a completion packet and either green evidence or a blocker/incident packet.
- **Stale-worker commit acceptance:** `0`.
- **Recovery point:** no loss of a committed state transition.
- **Recovery time:** supervisor projection and lease reconciliation complete within `5 minutes` for the qualification fixture, excluding provider outage.
- **Status freshness:** active-run summary reflects durable events within `30 seconds` under normal load.
- **Cancellation:** no new lease after durable cancellation; active workers receive stop/drain action within `60 seconds` under normal connectivity.
- **Scale truth:** observed physical workers/model calls must equal the claimed physical scale.
- **Budget enforcement:** no new worker starts after a hard budget is exhausted.

Performance is subordinate to correctness. V1 does not need maximum task throughput; it needs predictable throughput without state loss, merge corruption, or false claims.

## 21. Time, token, and compute estimates

These are planning ranges, not promises. Update `STATUS.md` after each phase with observed use.

| Phase | Focused engineering time | Model-token planning range | Compute placement |
|---|---:|---:|---|
| 1 | 1-2 days | 0.2M-0.6M | local light tests |
| 2 | 2-4 days | 0.5M-1.5M | local light tests |
| 3 | 4-7 days | 1.0M-3.0M | local tests + remote fault fixtures |
| 4 | 4-7 days | 1.0M-3.0M | local inventory + remote repo-scale checks |
| 5 | 4-7 days | 2.0M-6.0M | Hetzner real Codex workers |
| 6 | 3-6 days | 1.0M-3.0M | local/remote verifier matrix |
| 7 | 3-5 days | 0.5M-2.0M | Hetzner deployment/recovery |
| 8 | 5-10 elapsed days | 8.0M-25.0M hard-budgeted | Hetzner qualification campaigns |
| 9 | 2-4 days | 0.3M-1.0M | local + clean remote checkout |

Expected total:

- focused engineering: approximately `24-52` days of work before parallelization;
- realistic elapsed calendar with bounded parallel work: approximately `4-8 weeks`;
- model tokens: approximately `15M-45M`, dominated by real qualification rather than scaffolding;
- hardware: existing Hetzner server should be sufficient for v1’s 12-worker tier if resource caps and provider concurrency are respected;
- new paid infrastructure: not required by the current plan;
- human decision checkpoints: plan/budget approval policy, first real-worker canary, release-candidate review, legacy demotion.

Cost controls:

- each run has hard token, monetary, duration, worker-spawn, and retry budgets;
- qualification proceeds in ascending cost order;
- a failed lower gate blocks a more expensive higher gate;
- 25+ worker runs require a separate budget decision after v1.

## 22. Confusion-prevention rules

1. **One name:** `Agent Work` is the product; SLOS and benchmark runners are compatibility/qualification mechanisms.
2. **One entrypoint:** supported use goes through `packages/canonical-agent-work` and the `agent-work` CLI.
3. **One run truth:** durable runtime state and its projections outrank progress text, PID presence, or chat memory.
4. **One terminal authority:** `orchestrator-run-state` projection plus required evidence determines terminal truth.
5. **No worker completion authority:** workers return results; they never mark the objective complete.
6. **No verifier implementation writes:** verifiers evaluate immutable staged source.
7. **No local heavy fallback:** missing remote execution is a blocker, not permission to run the farm locally.
8. **No logical/physical count collapse:** requested, logical, spawned, started, completed, and provider-observed workers are reported separately.
9. **No benchmark/product collapse:** benchmark green does not imply product parity.
10. **No finite-queue completion:** exhausted work graph while objective-red triggers expansion or a blocker.
11. **No artifact-repo edits:** product work happens in active source paths, never returned artifact snapshots.
12. **No docs/tests inflation:** scaffolding does not count as product implementation unless declared.
13. **No silent retry:** retries are budgeted, classified, and evented.
14. **No unbound full-clone claim:** full clone requires reference inventory, parity matrix, independent verifiers, and zero required gaps.
15. **No compatibility creep:** new runtime primitives cannot be added only to SLOS v19/v20 or one-off benchmark scripts.
16. **No source durability assumption:** local save, local commit, push, remote verification, and release promotion are separate states.
17. **No learning from red evidence as truth:** learning artifacts remain quarantined until verifier-gated promotion.
18. **No destructive cleanup during release work:** quarantine first; delete only with Jake’s explicit approval.

## 23. Open decisions before code starts

The following defaults are chosen so implementation is not blocked. Jake can override them before the affected phase.

| Decision | Recommended v1 default | Needed by |
|---|---|---|
| Product exposure | private/internal platform first | Phase 2 |
| Operational store | SQLite WAL + portable JSONL/artifacts | Phase 3 |
| Worker provider | Codex first behind adapter interface | Phase 5 |
| Release concurrency | 12 observed physical workers | Phase 8 |
| Long-run gate | one six-hour unattended real-work soak | Phase 8 |
| Plan approval | digest approval for high-cost, external-write, or fidelity-sensitive runs; low-risk bounded internal runs may auto-admit under policy | Phase 2/4 |
| Brownfield transfer repo | PMHNP denial-copilot code-only fixture unless a cleaner approved repo is selected | Phase 8 |
| External writes | denied in all v1 qualification | all phases |
| Public claims | no external/public announcement as part of implementation | Phase 9 |

Decisions still requiring Jake only if changing the default:

- whether v1 should be prepared for open-source publication immediately;
- whether to fund 25+ worker post-v1 qualification;
- whether any qualification workload may deploy or touch an external system;
- whether to delete, rather than quarantine, legacy entrypoints after release.

## 24. Risks and mitigations

| Risk | Why it matters | Mitigation |
|---|---|---|
| Framework sprawl | existing components already overlap | facade first; authority matrix; no second runtime |
| False green | destroys trust in autonomous work | independent verification, contradiction blockers, adversarial fixtures |
| State corruption | long runs become unrecoverable | transactional store, append-only events, replay/fault matrix |
| Worker collision | parallelism can lose work | leases, fencing, worktrees, staged merge queue |
| Model/provider instability | workers may stall or return malformed output | adapter isolation, bounded retries, backpressure, blocker classification |
| Cost blowout | long multi-agent tests are expensive | ascending gates and hard budgets |
| Scale theater | high requested counts obscure low real work | feasible concurrency and provider-observed ledgers |
| Overfitting to Mailchimp | system may not transfer | four workload classes and brownfield gate |
| Security leakage | workers see broad workspace context | minimal context manifests, redaction, path/network/command policy |
| Benchmark code becomes product | truth can diverge between paths | benchmark runners consume public facade only |
| Cleanup breaks history | evidence and replay are valuable | quarantine + manifest; explicit delete approval |
| Operator overload | a capable system can still be unusable | compact status, sparse notifications, actionable blockers |

## 25. Immediate next milestone

**Milestone: Phase 1 contract and authority freeze.**

Next actions:

1. Create the v1 authority matrix and runtime schema catalog.
2. Add v1 schema fixtures and compatibility fixtures.
3. Inventory which current controller owns each transition and terminal decision.
4. Write the public facade behavior contract before moving runtime code.
5. Run targeted tests and full repository tests.
6. Update `STATUS.md` with observed baseline and any blockers.

Do not launch a high-cost agent campaign before Phases 1-4 are green.

## 26. Acceptance checks for the complete plan

The plan itself is acceptable when:

- target position is explicit and does not claim invention of multi-agent orchestration;
- active path and ownership are unambiguous;
- one canonical product/entrypoint is named;
- objective, fidelity, scope, non-goals, and stop condition are explicit;
- implementation phases have file surfaces, outputs, acceptance checks, and estimates;
- security, recovery, verification, operator experience, and qualification are first-class;
- physical worker truth is separated from logical/requested scale;
- current baseline is not misreported as v1 completion;
- all open decisions have safe defaults;
- `plan-doctor` passes after lifecycle files and the index are updated.

## 27. Definition of done

Agent Work v1 is done only when all boxes below are evidenced in the release packet:

- [ ] Stable v1 schemas and compatibility mapping exist.
- [ ] One public facade and CLI command family exists.
- [ ] Objective grounding, budgets, permissions, and execution placement fail closed.
- [ ] Automatic target inventory and declared reference inventory feed parity/negative-space truth.
- [ ] Dynamic expansion continues while objective-red or emits a blocker.
- [ ] Durable event/state storage survives the fault matrix.
- [ ] Lease fencing prevents stale-worker acceptance.
- [ ] Real Codex worker calls and usage are evidenced.
- [ ] Workers are isolated and cannot write canonical branches directly.
- [ ] Merge admission, conflict handling, rollback, and provenance are green.
- [ ] Independent verifiers bind evidence to exact source/patch digests.
- [ ] Contradictory truth blocks rather than passes.
- [ ] Operator status, resume, cancel, report, doctor, and incident bundle work.
- [ ] Security fixture suite is green.
- [ ] Cross-repo qualification meets the matrix in Section 19.
- [ ] Six-hour unattended real-work soak is green.
- [ ] Clean-room replay reproduces terminal truth.
- [ ] Full tests and project-specific acceptance checks are green at the release digest.
- [ ] Source is committed, pushed, and remotely verified.
- [ ] Release packet receives independent review.
- [ ] Remaining limitations and exact allowed claims are explicit.

## 28. Stop condition

Primary stop condition: `agent_work_v1_release_packet_green_or_blocker`.

`green` requires:

- every Definition of Done item is satisfied or explicitly marked not applicable with reviewer approval;
- the release packet contains source digests, artifact hashes, test evidence, qualification evidence, recovery evidence, security evidence, and exact claims;
- local and remote source truth agree;
- no P0/P1 correctness, security, recovery, or claim-integrity defect remains open.

`blocker` requires:

- a structured blocker report naming the failed gate;
- observed evidence and reproduction steps;
- whether the blocker is product, infrastructure, provider, budget, security, or decision-related;
- the smallest safe next action;
- no user-facing completion claim.

Running out of tasks, time, or model budget is not green.

## 29. Truth boundary

### Claim allowed now

- A detailed implementation and qualification plan now defines how the existing orchestration components can become Agent Work v1.
- The current stack has meaningful reusable mechanisms and `62/62` selected planning/truth tests passed on `2026-07-10`.
- The target position is a proof-carrying objective control plane around Codex/model workers, not a claim to have invented multi-agent coding.

### Claim not allowed now

- Agent Work v1 is finished or production-ready.
- The current canonical facade is restart-qualified end to end.
- Automatic parity discovery is complete for arbitrary products.
- A six-hour v1 release soak has passed.
- Twelve physical workers have passed the v1 qualification under this finalized architecture.
- The system is uniquely novel in all of its primitives.
- Full clone, universal autonomy, or 100-agent capability is proven.

### Final release claim shape

If every release gate passes, the maximum allowed claim is:

> Agent Work v1 is an internally production-qualified, proof-carrying orchestration control plane for long-running software objectives. It has been transfer-tested across the declared workload classes, restart- and fault-qualified, independently verified, and scale-qualified at 12 observed physical workers on the Hetzner execution plane. It uses Codex-first workers and does not claim universal product parity, arbitrary-provider support, or 100-agent qualification.
