# AI Operating System Plan

Template source: `/root/clawd/docs/PROJECT_PLAN_TEMPLATE.md`.

This plan upgrades the original freeform AI OS concept into the workspace-wide serious-project `plan.md` format. The original concept draft is preserved at `/root/clawd/ai-os/plan.freeform-20260630-before-template.md`.

## Plan metadata

- Project slug: `ai-os`
- Plan owner: `Jake + Cortex`
- Created: `2026-06-30`
- Last updated: `2026-07-04`
- Status: `active`
- Fidelity target: `platform`
- Primary stop condition: `boot_proof_green_or_blocker`
- Secondary stop condition: `release_candidate_packet_green_or_blocker`

## Planning map / confusion guard — 2026-07-04

- Canonical AI OS product/platform plan: this file, `/root/clawd/ai-os/plan.md`.
- Canonical Full Parity Engine plan: `/root/clawd/full-parity-engine/plan.md`.
- Workspace plan index: `/root/clawd/docs/PLAN_INDEX.md`.
- Historical AI OS concept draft: `/root/clawd/ai-os/plan.freeform-20260630-before-template.md`; preserve as archive only, not as current instructions.
- AI OS artifact recovery/rollback plans under `ai-os/artifacts/**/reports/*plan*.md` are evidence-only outputs, not active roadmaps.
- The 6h AI OS continuation green result proves sustained continuation/hardening for that benchmark; it does not replace the full AI OS plan or the Full Parity Engine plan.

## Implementation checkpoint — 2026-07-04 6h continuation source sync

Synced the terminal-green Hetzner 6h continuation product tree back into local `/root/clawd/ai-os`, validated it locally, committed it, and pushed it to GitHub.

Evidence:

- Remote run: `aios-language-toolchain-45a12w-6h-continuation-r1-20260704T021924Z`.
- Remote truth: `thresholdPass=true`, `mechanicalGreen=true`, `scaleProofReady=true`, no blocker.
- Final metrics: 30 waves, 361.51 minutes, 341 merged shards, 90 changed product files.
- Local validation after sync: `npm test` passed; contracts 7/7, product health ok, operator smoke ok; `git diff --check -- ai-os` passed.
- Commit: `13aa9a3ef` / `Sync AI OS 6h green continuation`, pushed and verified on `origin/master`.

Truth boundary: this promotes the 6h AI OS language/toolchain continuation/hardening source state. It does **not** claim runtime replacement, external-write enablement, full product parity, or a complete Full Parity Engine.

## Implementation checkpoint — 2026-06-30 Wave 0 contract slice

Completed the first production slice of implementation from this plan: Wave 0 contract artifacts and contract verification.

Implemented:

- `kernel/contracts/process.schema.json`
- `kernel/contracts/capability.schema.json`
- `kernel/contracts/syscall.schema.json`
- `kernel/contracts/claim.schema.json`
- `kernel/contracts/verifier.schema.json`
- `kernel/contracts/kernel_contract.json`
- `docs/BOOT_SEQUENCE.md`
- `docs/FILESYSTEM_LAYOUT.md`
- `tests/contracts.test.mjs`
- `package.json`
- `artifacts/aios-v0/latest/prior_art_reuse_map.json`
- `artifacts/aios-v0/latest/token_budget_estimate.json`
- `artifacts/aios-v0/latest/verifier_catalog.json`
- `artifacts/aios-v0/latest/run_contract.json`
- `artifacts/aios-v0/latest/surface_matrix.json`

Verification:

```bash
cd /root/clawd/ai-os && npm test
```

Observed result: `7/7` contract tests passed.

Truth boundary: this proves the Wave 0 contracts are present and internally checked. It does **not** prove the AI OS runtime boots or runs jobs yet; that is Wave 1.

## Implementation checkpoint — 2026-07-01 AI OS language profile

Evolved the shared Agent Work DSL into an AI-OS-ready source language profile instead of inventing a separate one-off language.

Implemented in `/root/clawd/large-project-capability-stack/packages/agent-work-dsl/index.mjs`:

- `ai_os` / `aios` language block parsing.
- `aios.agent_work_language_profile.v0.1` profile metadata.
- Plan-grounded fields for hosted kernel mode, process model, syscalls, memory mounts, capability defaults, boot evidence artifacts, boot commands, claim gate, truth boundary, reuse primitives, package model, and filesystem layout.
- AI OS boot evidence artifacts and claim-gate metadata, with default `evidence_mode: deferred_boot_claim` so implementation waves do not fail before boot/claim artifacts can exist.
- Compiled run-contract, surface-matrix, work-graph, metadata, and safety-report propagation for the AI OS profile.

Canonical AI OS language source artifact:

```text
/root/clawd/ai-os/artifacts/aios-v0/latest/aios_hosted_boot.agentwork.aw
```

Compiled artifact bundle:

```text
/root/clawd/ai-os/artifacts/aios-v0/latest/hosted_boot_agentwork/
```

Validation:

```bash
cd /root/clawd/large-project-capability-stack && node --check packages/agent-work-dsl/index.mjs && node --test tests/agent-work-dsl.test.mjs
cd /root/clawd/ai-os && npm test
```

Observed result: Agent Work DSL targeted suite passed `14/14`; AI OS contract suite passed `7/7`.

Truth boundary: this makes the AI OS boot milestone expressible as a compact, machine-compiled language source. It still does **not** prove the AI OS runtime boots; the next product milestone remains implementing the actual hosted boot path behind `aios-cli boot`, `run`, and `claim`.

## Implementation checkpoint — 2026-07-01 standard 45-wide language wave

Standardized heavy AI OS / Codex product-work scheduling around the observed realistic throughput limit:

- Preserve aggregate objective scale claims separately from physical wave width.
- Default heavy continuation waves to `min(45, remaining_ready_product_surfaces)`.
- Keep active Codex concurrency below physical wave width; current standard cap is about `12` active Codex calls.
- Use a global/message call budget around `55` for a 45-wide wave when repair room is needed.
- Do not force 45 agents for tiny or surgical jobs with fewer real product surfaces.

The canonical AI OS language source is now a real 45-surface hosted-kernel implementation slice instead of the earlier 8-surface boot-only slice:

```text
/root/clawd/ai-os/artifacts/aios-v0/latest/aios_hosted_boot.agentwork.aw
```

It records the 45-wide standard in AI OS profile metadata and keeps runner-enforced `wave_policy` limited to keys the current finite runner can honestly enforce (`max_waves`, `bundle_size`, `full_context_waves`, `handoff`). The Agent Work source now also declares `expansion_policy` with `strategy: repair_failed_surfaces`, so failed-surface orchestrator outcomes can produce bounded repair waves instead of dead-ending after one red wave. It covers operator userland, kernel lifecycle, scheduler, artifact filesystem, memory manager, capability security, syscall layer, verifier/claim gate, audit/recovery-adjacent proof paths, and package-facing runtime surfaces.

Truth boundary: this is a launch-shape and surface-inventory standard. It is not a boot/pass claim until the compiled contract runs and boot/run/claim verifiers are green.

## Implementation checkpoint — 2026-07-02/03 adapter recovery handoff

Completed a bounded production slice on the OpenClaw/Cortex adapter path for the AI OS language/kernel substrate.

Implemented in `/root/clawd/scripts/aios-adapter.mjs` and documented in `/root/clawd/docs/AI_OS_ADAPTER.md`:

- `recover` command for opt-in adapter artifact roots.
- Recovery checks for boot proof, run proof, verifier evidence, completion claim, process index, status/report handoff, job descriptor, and recovery/rollback plan availability.
- Local recovery report output at `reports/recovery-report.json`.
- Local recovery plan output at `reports/recovery-plan.md`.
- `status` fallback support for recovery reports.
- Latest-root pointer update for recovered roots.

Validation:

```bash
cd /root/clawd && node --check scripts/aios-adapter.mjs
cd /root/clawd/ai-os && npm test
node scripts/aios-adapter.mjs recover --artifact-root <ai-os/artifacts/openclaw-dogfood/root>
```

Observed local proof: `/root/clawd/ai-os/artifacts/openclaw-dogfood/adapter-recovery-handoff-20260703T044114Z` with boot/run/verifier/claim/recovery green.

Observed remote proof: `/home/jake/clawd-remote/ai-os/artifacts/openclaw-dogfood/adapter-recovery-handoff-remote-20260703T044440Z` with boot/run/verifier/claim/recovery green.

Truth boundary: this is a production-slice adapter recovery/status handoff. It does **not** promote AI OS to default runtime, perform external writes, or prove the full language frontend/toolchain.

## 1. Working name

**AI OS** — an operating system designed primarily for autonomous and semi-autonomous AI workers, with humans as owners/operators.

## 2. Decision summary

Build AI OS as a full operating-system-scale platform for AI cognition and action, beginning as a hosted AI-native kernel on Linux and later expanding toward a bootable distro image. The first milestone is a hosted v0.1 kernel that can boot, create an AI process, enforce capabilities, mediate syscalls/tools, write audit/proof artifacts, run verifiers, and truth-gate completion. This plan does **not** claim a native hardware OS, production readiness, or a full Windows/Linux-scale system yet.

## 3. Core thesis / objective

Primary objective:

- Create an AI-native operating system layer that manages autonomous work the way traditional operating systems manage human-operated programs: processes, scheduling, permissions, memory, files, devices/tools, logs, recovery, and exit truth.

User/operator served:

- Jake as owner/operator.
- Future humans who need safe, inspectable, high-scale AI worker systems.
- AI workers that need a structured runtime instead of ad hoc prompts, scripts, and chat threads.

Desired outcome:

- A usable AI OS kernel and userland that can run AI jobs as first-class processes with scoped authority, durable memory/artifacts, verifiable claims, auditability, and recovery.

Why existing tools are insufficient:

- Chat interfaces are not operating systems.
- Agent frameworks usually lack hard capability boundaries, durable proof, OS-like process lifecycle, audited syscalls, claim gates, and owner-governed scheduling.
- Current SLOS/Cortex/orchestration primitives are strong building blocks but not yet unified as a coherent AI-native OS.

Success changes:

- AI work becomes schedulable, inspectable, replayable, permissioned, and truth-gated.
- 100-agent programs can run under explicit kernel contracts instead of loose campaign scripts.
- Humans can operate agents through OS-level concepts: process table, jobs, permissions, logs, approvals, packages, memory mounts, and claims.

## 4. Scope

In scope:

- Hosted AI OS kernel running on Linux.
- AI process/job/thread model.
- Scheduler and execution-plane placement.
- AI filesystem/artifact namespace.
- Memory manager and memory mounts.
- Capability and permission model.
- Kernel-mediated syscall/tool driver layer.
- Verifier and proof/claim gate framework.
- Audit/provenance log and replay model.
- Operator CLI and later dashboard.
- Package/app model for AI OS userland components.
- Recovery, quarantine, blocker, and panic mechanisms.
- Developer SDK and docs.
- 100-agent build strategy after contracts are frozen.

## 5. Non-goals

Out of scope for the first milestone:

- Native hardware kernel.
- Replacing Linux drivers, networking, filesystems, or process isolation immediately.
- Public launch or production deployment.
- External writes/sends/deployments without explicit approval.
- Claiming Windows/Linux-scale parity.
- Letting 100 agents edit the whole system without ownership boundaries.
- Rebuilding SLOS/Cortex/orchestration primitives in parallel when they can be reused or wrapped.

Eventual ambition:

- Full AI-native operating system platform, possibly including a bootable Linux-based distro and later native/research kernel track.

Current milestone:

- Hosted AI OS v0.1 kernel with a real boot proof.

## 6. Active path / repo layout

Active path:

```text
/root/clawd/ai-os
```

Important paths:

```text
/root/clawd/ai-os/plan.md                                      # canonical project plan
/root/clawd/ai-os/plan.freeform-20260630-before-template.md    # preserved original concept draft
/root/clawd/ai-os/prior_art_gate_20260630T1903.json            # prior-art gate result
/root/clawd/ai-os/artifacts/plan/latest                        # planning artifacts
/root/clawd/large-project-capability-stack                     # SLOS/orchestration primitives to reuse
/root/clawd/public/cortex_server                               # Cortex memory/prior-art/structural memory primitives
```

Target repo layout:

```text
/root/clawd/ai-os
  plan.md
  kernel/
    contracts/
    runtime/
    policy/
    audit/
  userland/
    shell/
    dashboard/
  packages/
  apps/
  examples/
  docs/
  tests/
  artifacts/
```

Quarantined or superseded paths:

```text
benchmark-only artifacts       # not canonical product implementation
scratch generated OS drafts    # not active unless promoted with evidence
```

Path rules:

- AI OS must not be buried inside benchmark artifacts.
- SLOS/Cortex/shared stack can be reused as dependencies, but `/root/clawd/ai-os` is the product home.
- Scratch paths must not become canonical by accident.

## 7. Prior art and existing assets

Prior-art gate decision: `extend_existing_or_adapter_required`

Prior-art artifact:

```text
/root/clawd/ai-os/prior_art_gate_20260630T1903.json
```

Existing assets to reuse/extend:

- **SLOS v20/v0.1 RC** — intake, local runner, remote dispatch, claim gate, artifact bundle, RC packet.
- **Cortex memory** — durable memory, structural code graph, prior-art gate, retrieval/routing.
- **Multi-agent orchestrator** — shard planning, leases, patch queue, supervisors, context governance, remote workers.
- **Claim/proof tooling** — claim integrity, artifact manifests, verifier evidence, release packet patterns.
- **Hetzner execution plane** — off-host heavy execution boundary.
- **Cortex reasoning OS prior work** — earlier reasoning kernel/planner/scheduler ideas should be inspected before implementation.

Known overlaps or duplication risks:

- Building a second SLOS instead of an AI OS kernel that consumes SLOS primitives.
- Reimplementing Cortex memory rather than mounting it as a memory subsystem.
- Creating benchmark-only OS behavior that does not exist in product paths.
- Confusing hosted AI OS kernel with native hardware OS.

Decision:

- AI OS should **extend and wrap** existing primitives behind OS-style kernel interfaces.
- New primitives are justified only when the prior-art gate shows no adequate reusable substrate.

## 8. Target architecture

Architecture summary:

AI OS is a hosted operating-system layer for AI workers. It begins as a daemon/service on Linux with a strict AI kernel, process model, scheduler, filesystem/artifact store, memory manager, capabilities, syscalls/tool drivers, verifiers, audit log, shell, package model, and userland services. The trusted kernel stays small; userland can grow large.

Subsystems:

- **AI Kernel** — trusted invariants, lifecycle, claims, capabilities, audit, panic/stop rules.
- **Process Model** — jobs, processes, threads, states, owners, objectives, exit contracts.
- **Scheduler** — admission, priorities, leases, budgets, model/provider policy, execution-plane placement.
- **AI Filesystem / Artifact Store** — evidence, claims, memory mounts, working dirs, bundles, quarantine.
- **Memory Manager** — working/project/user/structural/episodic memory mounts with trust metadata.
- **Capability Security** — scoped authority for files, shell, tools, external systems, deploys, money, identity.
- **Syscall / Tool Driver Layer** — kernel-mediated access to shell, browser, git, memory, calendar, messaging, Home Assistant, agents, verifiers.
- **Verifier Framework** — tests, policy gates, artifact integrity, claim gates, replay checks, human review.
- **Audit / Recovery** — append-only events, snapshots, rollback, panic inspection, resume.
- **Userland Shell / UI** — CLI and dashboard for jobs, processes, logs, claims, approvals, packages.
- **Package/App Model** — installable AI roles, workflows, drivers, verifiers, memory packs, UI widgets.
- **SDK** — APIs/types/docs for building AI OS apps and drivers.

Key boundaries:

- Hosted AI kernel vs host Linux kernel.
- Kernel core vs userland services.
- Control plane vs execution plane.
- Internal reversible writes vs external user-visible actions.
- Memory as orientation vs live telemetry.
- Planning/scaffolding vs product implementation.

Interface contracts:

```text
kernel/contracts/process.schema.json       # Process/job/thread schema
kernel/contracts/capability.schema.json    # Capability token/policy schema
kernel/contracts/syscall.schema.json       # Syscall/tool descriptor schema
kernel/contracts/claim.schema.json         # Claim/exit contract schema
kernel/contracts/verifier.schema.json      # Verifier result schema
kernel/contracts/audit-event.schema.json   # Append-only audit event schema
```

Architecture decisions:

| Decision | Options considered | Chosen option | Reason | Revisit when |
|---|---|---|---|---|
| First boot target | hosted Linux daemon, bootable distro, native kernel | hosted Linux daemon | fastest real value; reuses host OS and current stack | hosted kernel proves useful and stable |
| Long-term boot target | hosted only, Linux distro, native kernel | hosted first, distro second, native research later | avoids driver trap while preserving OS ambition | after v0.1/v1 proof |
| Prior-art strategy | rebuild, wrap, extend | wrap/extend existing SLOS/Cortex/orchestrator primitives | avoids duplicate architecture | prior-art gap is proven |
| Agent scale | 100 agents immediately, staged waves | 10-agent specs → 25-agent prototype → 100-agent subsystem wave | prevents chaos/collisions | contracts/verifiers green |
| Token budgeting | exact estimate, scenario ranges | scenario ranges + actual ledger | AI OS scope is uncertain | after each wave |

## 9. Surface matrix / subsystem ownership

| Surface / subsystem | Owner / agent squad | Primary files | Allowed write scope | Verifiers | Claim allowed when |
|---|---|---|---|---|---|
| Kernel contracts | kernel contract squad | `kernel/contracts/**` | schemas/docs/tests | schema validation, lifecycle tests | contracts validate and no overlap contradiction |
| Process runtime | process squad | `kernel/runtime/process*` | process lifecycle files | process lifecycle tests | jobs create/run/block/complete truthfully |
| Scheduler | scheduler squad | `kernel/runtime/scheduler*` | scheduler/leases/budget files | lease/budget/concurrency tests | placement/admission is deterministic and audited |
| AIFS/artifacts | filesystem squad | `kernel/runtime/fs*`, `artifacts/**` | artifact store and manifests | tamper/replay tests | claim evidence is content-addressed/replayable |
| Memory manager | memory squad | `kernel/runtime/memory*` | memory mount adapters | stale/live/trust tests | memory reads/writes carry source/trust metadata |
| Capabilities | security squad | `kernel/policy/capability*` | capability and policy files | unauthorized syscall tests | unauthorized actions fail closed |
| Syscalls/drivers | driver squad | `kernel/runtime/syscall*`, `packages/drivers/**` | syscall registry/driver adapters | policy/audit tests | every tool call emits audit event |
| Verifiers/claim gate | verifier squad | `kernel/runtime/verifier*`, `kernel/runtime/claim*` | verifier and claim files | pass/fail/block tests | completed claims require green verifier contract |
| Shell/UI | userland squad | `apps/aios-cli.mjs`, `userland/**` | CLI/dashboard files | operator journey tests | human can inspect jobs/claims without raw-log spelunking |
| Packages/SDK | package squad | `packages/**`, `docs/sdk/**` | package/SDK files | install/rollback/API tests | package install/rollback is audited |
| Release/evidence | release squad | `artifacts/**`, `docs/**` | release packet/artifacts | artifact bundle + replay tests | RC packet proves exact bounded claim |

Ownership rules:

- Agents may only edit owned files/surfaces unless a merge/lease gate expands scope.
- Shared files require explicit lease or patch queue.
- Docs/tests/harness-only diffs do not count as product implementation unless that surface is explicitly docs/tests/harness.

## 10. Agent strategy

Agent count target: staged `10 → 25 → 100`.

Execution placement:

- Control plane: `/root/clawd`
- Product path: `/root/clawd/ai-os`
- Execution plane: `jake@37.27.129.239:/home/jake/clawd-remote` for heavy/multi-agent runs
- Remote boundary required? `yes` for 25+ agents, browser-heavy checks, or long-running validation
- Heavy execution allowed locally? `no` by default

Agent roles:

- planner: decomposes objective into contracts/surfaces/waves.
- implementer: builds owned product surfaces.
- verifier: writes/runs tests and artifact gates.
- reviewer: checks architecture coherence, duplication, and truth boundary.
- release/audit: builds bundles, claim gate, replay commands, token ledger.

Launch gates before using many agents:

- [ ] surface matrix exists
- [ ] file ownership/lease strategy exists
- [ ] verifier catalog exists
- [ ] artifact return contract exists
- [ ] blocker format exists
- [ ] stop condition is artifact-backed
- [ ] execution plane is verified when needed
- [ ] prior-art gate has been run for new primitives
- [ ] token ceiling has been selected for the wave

## 11. Phases / waves

### Wave 0 — Plan, prior-art, and contract freeze

Goal:

- Convert the AI OS ambition into implementation contracts and freeze v0.1 scope.

Inputs:

- This `plan.md`.
- Original freeform plan.
- Prior-art gate result.
- SLOS/Cortex/orchestration artifacts.

Outputs:

- `kernel_contract.json`
- `process.schema.json`
- `capability.schema.json`
- `syscall.schema.json`
- `claim.schema.json`
- `verifier.schema.json`
- `filesystem_layout.md`
- `boot_sequence.md`
- `verifier_catalog.json`
- `token_budget_estimate.json`

Verifiers:

```bash
node --test tests/contracts.test.mjs
node --test tests/prior-art-reuse.test.mjs
```

Stop condition:

```text
contracts_green_or_blocker_report
```

Estimated token usage:

- `20M-100M` tokens.

### Wave 1 — Hosted kernel boot proof

Goal:

- Boot AI OS locally as a hosted kernel and run one verified job.

Inputs:

- Frozen contracts from Wave 0.

Outputs:

- `apps/aios-cli.mjs`
- `kernel/runtime/*`
- `examples/hello.job.json`
- boot artifact bundle
- audit log
- claim gate result

Verifiers:

```bash
node apps/aios-cli.mjs boot --artifact-root artifacts/aios-v0/latest
node apps/aios-cli.mjs run examples/hello.job.json --artifact-root artifacts/aios-v0/latest
node apps/aios-cli.mjs claim examples/hello.job.json --artifact-root artifacts/aios-v0/latest
node --test tests/kernel-lifecycle.test.mjs
```

Stop condition:

```text
boot_proof_green_or_blocker
```

Estimated token usage:

- `150M-500M` tokens.

### Wave 2 — Scheduler and isolated multi-process runtime

Goal:

- Run multiple AI processes with leases, budgets, context mounts, and verifier-gated exits.

Outputs:

- process table
- scheduler queue
- file lease manager
- budget manager
- 10-agent local simulation
- 25-agent remote simulation

Verifiers:

```bash
node --test tests/scheduler.test.mjs
node --test tests/process-isolation.test.mjs
node --test tests/budget-policy.test.mjs
```

Stop condition:

```text
multi_process_runtime_green_or_blocker
```

Estimated token usage:

- `300M-1B` tokens.

### Wave 3 — Filesystem, memory, artifacts, and replay

Goal:

- Make AI filesystem and memory mounts real enough for claim replay.

Outputs:

- content-addressed artifacts
- memory mount manifests
- claim-to-evidence links
- artifact bundle manifests
- quarantine namespace
- replay verifier

Verifiers:

```bash
node --test tests/artifact-store.test.mjs
node --test tests/memory-mounts.test.mjs
node --test tests/claim-replay.test.mjs
```

Stop condition:

```text
artifact_replay_green_or_blocker
```

Estimated token usage:

- `300M-1.5B` tokens.

### Wave 4 — Capability security and syscalls

Goal:

- Put raw tool use behind kernel-mediated syscall/capability checks.

Outputs:

- capability policy engine
- syscall registry
- audit events for every syscall
- approval hooks
- revocation path
- external action guardrails

Verifiers:

```bash
node --test tests/capability-policy.test.mjs
node --test tests/syscall-audit.test.mjs
node --test tests/external-action-guardrails.test.mjs
```

Stop condition:

```text
capability_security_green_or_blocker
```

Estimated token usage:

- `400M-2B` tokens.

### Wave 5 — Userland shell, dashboard, and operator workflows

Goal:

- Give humans a usable OS interface.

Outputs:

- CLI shell
- process/job list
- logs/audit viewer
- claim browser
- approval console
- package list
- dashboard prototype

Verifiers:

```bash
node --test tests/operator-shell.test.mjs
node --test tests/operator-journeys.test.mjs
```

Stop condition:

```text
operator_workflows_green_or_blocker
```

Estimated token usage:

- `300M-1.5B` tokens.

### Wave 6 — Package/app model and SDK

Goal:

- Install/run/rollback AI OS packages and expose developer APIs.

Outputs:

- package manifest schema
- install/rollback engine
- toy verifier package
- toy driver package
- SDK docs/types

Verifiers:

```bash
node --test tests/package-manager.test.mjs
node --test tests/sdk-contracts.test.mjs
```

Stop condition:

```text
package_model_green_or_blocker
```

Estimated token usage:

- `300M-1B` tokens.

### Wave 7 — 100-agent self-build dogfood

Goal:

- Use AI OS to coordinate a bounded AI OS improvement wave.

Outputs:

- 100 agent assignments
- ownership matrix
- remote execution proof
- merge/admission queue
- supervisor truth
- release candidate packet

Verifiers:

```bash
npm run ops:ai-os:self-build-dogfood
node --test tests/self-build-dogfood.test.mjs
```

Stop condition:

```text
release_candidate_packet_green_or_blocker
```

Estimated token usage:

- `500M-2B` tokens.

### Wave 8 — Bootable distro image

Goal:

- Boot a Linux-based VM/server image into AI OS as the default operator environment.

Outputs:

- distro/image build recipe
- AI OS service starts on boot
- operator shell available
- secure default capability policy
- recovery path

Verifiers:

```bash
<vm-boot-proof-command>
<aios-boot-proof-command>
```

Stop condition:

```text
bootable_distro_green_or_blocker
```

Estimated token usage:

- `1B-5B` tokens.

### Wave 9 — Native/research kernel decision

Goal:

- Decide whether a native kernel/microkernel path is justified.

Outputs:

- architecture decision record
- threat model
- substrate comparison: Linux-hosted vs distro vs seL4/Redox/unikernel/custom Rust kernel
- prototype boot spike if justified, or explicit no-go

Verifiers:

```bash
<research-review-command>
<prototype-boot-command-if-applicable>
```

Stop condition:

```text
native_kernel_go_no_go_decision
```

Estimated token usage:

- `500M-10B+` tokens, depending on whether a prototype is attempted.

## 12. Token usage estimate contract

Observed planning basis:

- Recent 100-agent Mailchimp orchestration used `189,143,272` observed tokens over `491.21` minutes.
- Derived rate: about `23.1M tokens/hour` or `92.4M tokens per 4-hour 100-agent block`.
- Safe planning budget for a 4-hour 100-agent block: `100M-150M` tokens.

AI OS scenario estimates:

| Target | Estimated tokens | Approx 4h 100-agent blocks | What it proves |
|---|---:|---:|---|
| Spec/contracts + plan tournament | `20M-100M` | `<1` | architecture/contracts, not implementation |
| Kernel prototype + first boot proof | `150M-500M` | `1-5` | hosted v0 boot/job/claim proof |
| Hosted AI OS v0.1 | `500M-2B` | `5-20` | usable bounded kernel/userland RC |
| Usable v1 platform | `5B-20B` | `50-200` | meaningful platform with userland/package/security/runtime |
| Windows/Linux-scale long-term ambition | `50B-300B+` | `500-3000+` | multi-year full OS-scale platform ambition |

Recommendation:

- First budget `~500M` tokens for a serious v0.1 attempt.
- Do not authorize multi-billion-token v1 work until v0.1 boot proof and fresh inventory exist.
- Record actual token usage after every wave in `token_usage_ledger.json`.

## 13. Verifier and evidence contract

Required verifiers:

```bash
node --test tests/contracts.test.mjs
node --test tests/kernel-lifecycle.test.mjs
node --test tests/process-isolation.test.mjs
node --test tests/scheduler.test.mjs
node --test tests/artifact-store.test.mjs
node --test tests/memory-mounts.test.mjs
node --test tests/capability-policy.test.mjs
node --test tests/syscall-audit.test.mjs
node --test tests/claim-replay.test.mjs
node --test tests/operator-journeys.test.mjs
```

Evidence artifacts:

```text
artifacts/aios-v0/latest/boot_proof.json             # proves hosted kernel boot
artifacts/aios-v0/latest/process_lifecycle.json      # proves process states and exits
artifacts/aios-v0/latest/capability_audit.json       # proves capability enforcement
artifacts/aios-v0/latest/syscall_audit.json          # proves mediated tool access
artifacts/aios-v0/latest/claim_gate.json             # proves allowed claims
artifacts/aios-v0/latest/artifact_bundle_manifest.json
artifacts/aios-v0/latest/token_usage_ledger.json
artifacts/aios-v0/latest/release_packet.json
```

Claim matrix:

| Claim | Required evidence | Verifier | Allowed wording |
|---|---|---|---|
| Plan exists | `plan.md` | file review | “AI OS has a serious project plan” |
| Contracts green | contract schemas + tests | `tests/contracts.test.mjs` | “v0.1 contracts are frozen” |
| Hosted boot proof | boot proof + lifecycle tests | boot CLI + tests | “hosted AI OS kernel boots” |
| Process completion proof | process lifecycle + claim gate | lifecycle/claim tests | “AI OS can truth-gate a job” |
| Capability security proof | denied unauthorized syscall + audited approved syscall | capability/syscall tests | “capabilities enforced for tested syscalls” |
| 100-agent self-build proof | release packet + remote artifacts | self-build dogfood | “bounded 100-agent AI OS dogfood passed” |
| Native OS claim | bootable native kernel proof | native boot verifier | not allowed yet |

A claim is green only when:

- The exact artifact exists.
- The artifact is current for active path.
- The verifier maps to the claim wording.
- No contradictory artifact exists.
- Claim gate allows the wording.

A blocker must be written when:

- Prior-art overlap is unresolved.
- Contracts conflict.
- Execution boundary is missing for heavy runs.
- Capability policy cannot fail closed.
- The boot proof is not replayable.
- Native/distro claims are attempted before boot evidence exists.

## 14. Capability, safety, and external-action policy

Capability matrix:

| Capability | Default | Requires approval? | Audit artifact | Revocation / rollback |
|---|---|---|---|---|
| read AI OS workspace | allowed | no | audit event | n/a |
| write AI OS workspace | scoped | no for reversible project files | git diff/artifact | revert patch |
| run local tests | allowed | no | test log | n/a |
| run heavy remote agents | gated | yes unless specifically requested | run contract | stop job/blocker |
| shell/syscall access | policy mediated | depends on risk | syscall audit | kill/revoke capability |
| external reads | scoped | maybe | audit event | n/a |
| external writes/sends/deploys | blocked by default | yes | approval artifact | rollback/mitigation |
| privileged kernel policy changes | gated | yes for risky changes | policy diff + tests | revert/panic |

Safety rules:

- No external user-visible action without explicit approval.
- No destructive action without explicit approval and rollback/backup plan.
- No secrets in logs, plans, artifacts, or memory.
- If safety and completion conflict, stop and write a blocker.
- AI OS should make dangerous actions harder, not easier.

## 15. Artifacts and replay commands

Canonical artifact root:

```text
/root/clawd/ai-os/artifacts/aios-v0/latest
```

Expected artifacts:

```text
surface_matrix.json
work_graph.json
run_contract.json
verifier_catalog.json
execution_summary.json
claim_gate.json
blocker_report.json
release_packet.json
artifact_bundle_manifest.json
token_usage_ledger.json
boot_proof.json
capability_audit.json
syscall_audit.json
```

Initial replay commands:

```bash
node apps/aios-cli.mjs boot --artifact-root artifacts/aios-v0/latest
node apps/aios-cli.mjs run examples/hello.job.json --artifact-root artifacts/aios-v0/latest
node apps/aios-cli.mjs claim examples/hello.job.json --artifact-root artifacts/aios-v0/latest
node --test tests/kernel-lifecycle.test.mjs
```

Artifact integrity requirements:

- Every release packet includes checksums or a manifest.
- Boot proof must be replayable from a clean checkout.
- Token ledger records estimate vs actual per wave.
- Blockers are artifacts, not just chat notes.

## 16. Stop condition

The first milestone stops when:

```text
boot_proof_green_or_blocker
```

AI OS v0.1 RC stops when:

```text
release_candidate_packet_green_or_blocker
```

Hosted v0.1 completion requires:

- process schema green,
- capability schema green,
- syscall schema green,
- hosted kernel boot proof,
- one verified job run,
- audit log produced,
- claim gate green,
- artifact bundle manifest green,
- token ledger present,
- release packet with truth boundary.

Completion is not allowed merely because:

- a plan exists,
- a demo script prints success,
- 100 agents ran,
- docs describe an OS,
- hosted daemon exists but cannot truth-gate jobs,
- distro/native claims lack boot evidence.

## 17. Truth boundary

This plan may claim:

- AI OS has a serious project plan.
- The intended product ambition is full OS-scale.
- The first implementation target is a hosted AI OS kernel on Linux.
- Existing SLOS/Cortex/orchestration assets should be reused/extended.
- Token estimates are scenario ranges based partly on observed 100-agent runs.

This plan may **not** claim yet:

- AI OS is implemented.
- AI OS v0.1 exists.
- AI OS is a native operating system.
- AI OS is production-ready.
- AI OS has full Windows/Linux-scale parity.
- 100 agents can safely build it before contracts/verifiers are green.

Truth layers to keep separate:

- planning/scaffolding,
- hosted AI OS kernel,
- bootable Linux-based distro,
- native/research kernel,
- product implementation,
- benchmark/dogfood proof,
- release candidate,
- production/public readiness.

## 18. Risks and mitigations

| Risk | Why it matters | Mitigation | Evidence mitigation works |
|---|---|---|---|
| Duplicate SLOS/Cortex architecture | wastes work and creates conflicting primitives | prior-art gate + adapter-first policy | prior-art artifact + reuse tests |
| Benchmark-only OS | demos pass but product has no real kernel | build product CLI/kernel first; benchmarks consume product paths | boot proof from product path |
| 100-agent chaos | file collisions and incoherent subsystems | staged contracts, ownership matrix, leases | patch queue/admission artifacts |
| Fake native OS claim | hosted daemon mistaken for true OS | explicit truth layers and boot proof requirements | claim gate blocks wording |
| Unsafe external action | OS could amplify mistakes | default-deny capabilities and approvals | unauthorized syscall tests |
| Memory hallucination/staleness | OS makes wrong decisions from stale facts | source/trust metadata and live checks for volatile state | memory mount tests |
| Token runaway | large platform could burn billions | wave token ceilings and ledger | token_usage_ledger.json |
| Kernel/userland boundary blur | trusted core becomes too large to reason about | small kernel, large userland | subsystem boundary tests |
| Execution-plane misuse | control host overloaded | remote boundary rule | remote health proof |

## 19. Open questions

| Question | Why it matters | Owner | Needed by | Resolution artifact |
|---|---|---|---|---|
| What exact SLOS primitives become kernel APIs vs userland services? | prevents duplication | Cortex | Wave 0 | `prior_art_reuse_map.json` |
| What is the minimal v0.1 process schema? | boot proof depends on it | kernel squad | Wave 0 | `process.schema.json` |
| Which syscalls are in v0.1? | controls safety and scope | driver/security squads | Wave 0 | `syscall.schema.json` |
| What token ceiling should v0.1 receive? | cost/control | Jake | before Wave 1 | `run_contract.json` |
| Should dashboard come before package manager? | user value sequencing | Jake + Cortex | Wave 4/5 | roadmap update |
| When does bootable distro become worth it? | avoids premature native work | Cortex | after v0.1 | architecture decision record |

Do not block Wave 0 on questions that can safely be answered during contract design. Do block heavy implementation if the answer changes safety, architecture, active path, or stop condition.

## 20. Immediate next milestone

Next milestone:

- Produce Wave 0 contract artifacts and a v0.1 boot-proof run contract.

Next action:

```bash
mkdir -p kernel/contracts kernel/runtime kernel/policy kernel/audit apps examples tests docs artifacts/aios-v0/latest
```

Then create:

```text
kernel/contracts/process.schema.json
kernel/contracts/capability.schema.json
kernel/contracts/syscall.schema.json
kernel/contracts/claim.schema.json
kernel/contracts/verifier.schema.json
docs/BOOT_SEQUENCE.md
tests/contracts.test.mjs
artifacts/aios-v0/latest/token_budget_estimate.json
```

Done when:

- contract tests pass,
- prior-art reuse map exists,
- v0.1 boot proof run contract exists,
- Jake can choose whether to spend the first `150M-500M` token implementation budget.

## 21. Plan maintenance

Update this plan when:

- scope changes,
- architecture changes,
- active path changes,
- a phase completes,
- a blocker changes the route,
- verifier truth changes,
- token estimates differ materially from actuals,
- agent count/execution placement changes,
- Jake makes a strategic decision.

Memory/update path:

```text
/root/clawd/memory/projects/ai-os.md
```

Plan truth boundary:

This `plan.md` is a planning and coordination artifact. It is not implementation proof. Completion claims require the evidence and verifiers named above.
