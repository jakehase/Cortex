# Canonical Agent Work / AI OS language source for the hosted v0.1 boot milestone.
# Grounded in /root/clawd/ai-os/plan.md.
# Truth boundary: this describes and launches the next boot-proof implementation job;
# it does not claim the AI OS boots until boot/run/claim verifiers are green.

goal AIOSHostedKernelBootProof
repo /root/clawd/ai-os
artifact_root artifacts/aios-v0/latest/hosted_boot_agentwork
fidelity production_slice
benchmark_tier real_worker_product_standard
agents 45
stop boot_proof_green_or_blocker
allow read_repo, write_product_code, run_tests
forbid external_send, touch_prod, relaunch_benchmark
done boot_proof_green, no_truth_layer_overclaim
product_diff_mode: creative_product_work
require_real_product_diffs: true
creative_product_work: {"required":true,"promptMode":"compact","minIterations":1,"minWorkerRuntimeMs":0}
canonical_landing_evidence: {"enabled":true,"minAddedLineCount":1,"minUniqueNormalizedAddedLineCount":1,"duplicateLineRatioMax":0.55}

wave_policy
  max_waves: 3
  bundle_size: 1
  full_context_waves: 0
  handoff: wave_factpack

expansion_policy
  triggers: failed_surfaces, objective_red
  max_cycles: 2
  max_surfaces: 45
  strategy: repair_failed_surfaces

ai_os hosted_kernel_boot_proof
  plan: /root/clawd/ai-os/plan.md
  kernel: hosted_linux
  owner: Jake
  process_model: job, process, thread, owner, exit_contract
  syscalls: fs.read, fs.write, shell.exec, git.diff, memory.search, memory.write, verifier.run, claim.submit, audit.write
  memory_mounts: project_memory, structural_memory, episodic_log, artifact_store
  evidence: boot_proof.json, process_lifecycle.json, capability_audit.json, syscall_audit.json, claim_gate.json, artifact_bundle_manifest.json
  evidence_mode: deferred_boot_claim
  physical_wave_width: 45
  standard_heavy_wave_agent_count: 45
  active_codex_call_cap: 12
  global_call_budget: 55
  boot_commands: node apps/aios-cli.mjs boot --artifact-root artifacts/aios-v0/latest
  claim_gate: verifier_green_required
  truth_boundary: Hosted AI OS v0.1 boot proof only; do not claim native OS, production readiness, or general autonomous completion.

surface app_cli_entrypoint
  lane: operator_userland
  goal: Wire the top-level AI OS CLI entrypoint to route boot/run/claim/ps/logs/approve commands through operator-userland modules with clear exit codes.
  files: apps/aios-cli.mjs
  verify: node --check apps/aios-cli.mjs

surface operator_cli_boot
  lane: operator_userland
  goal: Implement hosted boot command orchestration, artifact-root initialization, and boot proof handoff.
  files: packages/aios-kernel/operator-userland/cli-boot.mjs
  verify: node --check packages/aios-kernel/operator-userland/cli-boot.mjs

surface operator_cli_run
  lane: operator_userland
  goal: Implement job run command admission flow for examples/hello.job.json and AI OS process creation.
  files: packages/aios-kernel/operator-userland/cli-run.mjs
  verify: node --check packages/aios-kernel/operator-userland/cli-run.mjs

surface operator_cli_claim
  lane: operator_userland
  goal: Implement claim command behavior that submits completion claims only through the verifier/claim gate.
  files: packages/aios-kernel/operator-userland/cli-claim.mjs
  verify: node --check packages/aios-kernel/operator-userland/cli-claim.mjs

surface operator_cli_ps
  lane: operator_userland
  goal: Implement process table presentation for hosted AI OS jobs, threads, leases, and exit contracts.
  files: packages/aios-kernel/operator-userland/cli-ps.mjs
  verify: node --check packages/aios-kernel/operator-userland/cli-ps.mjs

surface operator_cli_logs
  lane: operator_userland
  goal: Implement audit/log browsing for boot, run, claim, blocker, and recovery events.
  files: packages/aios-kernel/operator-userland/cli-logs.mjs
  verify: node --check packages/aios-kernel/operator-userland/cli-logs.mjs

surface operator_approval_console
  lane: operator_userland
  goal: Implement approval console data contracts for external writes, destructive actions, and privileged kernel changes.
  files: packages/aios-kernel/operator-userland/approval-console.mjs
  verify: node --check packages/aios-kernel/operator-userland/approval-console.mjs

surface operator_dashboard_model
  lane: operator_userland
  goal: Implement dashboard state model for kernel health, running jobs, proof status, blockers, and operator actions.
  files: packages/aios-kernel/operator-userland/dashboard-model.mjs
  verify: node --check packages/aios-kernel/operator-userland/dashboard-model.mjs

surface kernel_process_admission
  lane: kernel_lifecycle
  goal: Implement process admission validation, owner binding, objective normalization, and initial lifecycle evidence references.
  files: packages/aios-kernel/kernel-lifecycle/process-admission.mjs
  verify: node --check packages/aios-kernel/kernel-lifecycle/process-admission.mjs

surface kernel_state_transition
  lane: kernel_lifecycle
  goal: Implement allowed process state transitions, terminal states, failure reasons, and replayable transition records.
  files: packages/aios-kernel/kernel-lifecycle/state-transition.mjs
  verify: node --check packages/aios-kernel/kernel-lifecycle/state-transition.mjs

surface kernel_exit_contract
  lane: kernel_lifecycle
  goal: Implement exit contract checks for done, blocked, killed, quarantined, and claim-submitted process exits.
  files: packages/aios-kernel/kernel-lifecycle/exit-contract.mjs
  verify: node --check packages/aios-kernel/kernel-lifecycle/exit-contract.mjs

surface kernel_owner_identity
  lane: kernel_lifecycle
  goal: Implement owner identity normalization and authorization metadata for jobs and privileged actions.
  files: packages/aios-kernel/kernel-lifecycle/owner-identity.mjs
  verify: node --check packages/aios-kernel/kernel-lifecycle/owner-identity.mjs

surface kernel_process_snapshot
  lane: kernel_lifecycle
  goal: Implement process snapshot serialization for ps, replay, recovery, and claim evidence.
  files: packages/aios-kernel/kernel-lifecycle/process-snapshot.mjs
  verify: node --check packages/aios-kernel/kernel-lifecycle/process-snapshot.mjs

surface kernel_panic_stop
  lane: kernel_lifecycle
  goal: Implement panic/stop semantics for unsafe jobs, runaway workers, and external-write risk.
  files: packages/aios-kernel/kernel-lifecycle/panic-stop.mjs
  verify: node --check packages/aios-kernel/kernel-lifecycle/panic-stop.mjs

surface scheduler_admission_queue
  lane: scheduler
  goal: Implement job admission queue ordering, readiness, dependency hold, and operator override metadata.
  files: packages/aios-kernel/scheduler/admission-queue.mjs
  verify: node --check packages/aios-kernel/scheduler/admission-queue.mjs

surface scheduler_budget_manager
  lane: scheduler
  goal: Implement budget accounting for tokens, messages, wall-clock, retries, and 45-wide wave policy.
  files: packages/aios-kernel/scheduler/budget-manager.mjs
  verify: node --check packages/aios-kernel/scheduler/budget-manager.mjs

surface scheduler_context_pack
  lane: scheduler
  goal: Implement context-pack shaping for compact worker launches, memory mounts, and assigned-file retrieval.
  files: packages/aios-kernel/scheduler/context-pack.mjs
  verify: node --check packages/aios-kernel/scheduler/context-pack.mjs

surface scheduler_dependency_graph
  lane: scheduler
  goal: Implement dependency graph validation, ready frontier selection, and cycle/blocker reporting.
  files: packages/aios-kernel/scheduler/dependency-graph.mjs
  verify: node --check packages/aios-kernel/scheduler/dependency-graph.mjs

surface scheduler_execution_plane_registry
  lane: scheduler
  goal: Implement execution-plane registry selection for local control plane vs Hetzner worker plane.
  files: packages/aios-kernel/scheduler/execution-plane-registry.mjs
  verify: node --check packages/aios-kernel/scheduler/execution-plane-registry.mjs

surface scheduler_lease_manager
  lane: scheduler
  goal: Implement worker leases, lease renewal, stale lease detection, and recovery-safe ownership.
  files: packages/aios-kernel/scheduler/lease-manager.mjs
  verify: node --check packages/aios-kernel/scheduler/lease-manager.mjs

surface scheduler_model_policy
  lane: scheduler
  goal: Implement model/provider policy selection for planner, compact worker, verifier, and reviewer roles.
  files: packages/aios-kernel/scheduler/model-policy.mjs
  verify: node --check packages/aios-kernel/scheduler/model-policy.mjs

surface scheduler_usage_backoff
  lane: scheduler
  goal: Implement usage-limit/backoff tracking for OAuth/message-metered Codex lanes and resume timing.
  files: packages/aios-kernel/scheduler/usage-backoff.mjs
  verify: node --check packages/aios-kernel/scheduler/usage-backoff.mjs

surface artifact_root
  lane: artifact_filesystem
  goal: Implement stable artifact-root initialization, namespace layout, required boot paths, and root metadata.
  files: packages/aios-kernel/artifact-filesystem/artifact-root.mjs
  verify: node --check packages/aios-kernel/artifact-filesystem/artifact-root.mjs

surface artifact_bundle_manifest
  lane: artifact_filesystem
  goal: Implement content-addressed artifact bundle manifests for boot, run, claim, release, and recovery packets.
  files: packages/aios-kernel/artifact-filesystem/bundle-manifest.mjs
  verify: node --check packages/aios-kernel/artifact-filesystem/bundle-manifest.mjs

surface artifact_content_address
  lane: artifact_filesystem
  goal: Implement digest/address helpers for evidence artifacts, manifests, and tamper checks.
  files: packages/aios-kernel/artifact-filesystem/content-address.mjs
  verify: node --check packages/aios-kernel/artifact-filesystem/content-address.mjs

surface artifact_path_policy
  lane: artifact_filesystem
  goal: Implement safe path policy for artifact writes, quarantine, and repo-relative proof references.
  files: packages/aios-kernel/artifact-filesystem/path-policy.mjs
  verify: node --check packages/aios-kernel/artifact-filesystem/path-policy.mjs

surface artifact_claim_evidence_link
  lane: artifact_filesystem
  goal: Implement claim-to-evidence linking so every claim can trace required proof artifacts.
  files: packages/aios-kernel/artifact-filesystem/claim-evidence-link.mjs
  verify: node --check packages/aios-kernel/artifact-filesystem/claim-evidence-link.mjs

surface artifact_replay_index
  lane: artifact_filesystem
  goal: Implement replay index records that map jobs/processes/claims to audit and artifact bundles.
  files: packages/aios-kernel/artifact-filesystem/replay-index.mjs
  verify: node --check packages/aios-kernel/artifact-filesystem/replay-index.mjs

surface memory_mount
  lane: memory_manager
  goal: Implement memory mount descriptors for project, structural, episodic, artifact, and volatile memory.
  files: packages/aios-kernel/memory-manager/memory-mount.mjs
  verify: node --check packages/aios-kernel/memory-manager/memory-mount.mjs

surface memory_project_adapter
  lane: memory_manager
  goal: Implement project memory adapter contracts for reading/writing canonical project status safely.
  files: packages/aios-kernel/memory-manager/project-memory-adapter.mjs
  verify: node --check packages/aios-kernel/memory-manager/project-memory-adapter.mjs

surface memory_structural_adapter
  lane: memory_manager
  goal: Implement structural memory adapter contracts for code graph lookups and source provenance.
  files: packages/aios-kernel/memory-manager/structural-memory-adapter.mjs
  verify: node --check packages/aios-kernel/memory-manager/structural-memory-adapter.mjs

surface memory_episodic_log
  lane: memory_manager
  goal: Implement episodic log adapter for durable run events, handoffs, and operator-visible summaries.
  files: packages/aios-kernel/memory-manager/episodic-log-adapter.mjs
  verify: node --check packages/aios-kernel/memory-manager/episodic-log-adapter.mjs

surface memory_freshness_gate
  lane: memory_manager
  goal: Implement freshness gates for volatile facts before current-state claims are allowed.
  files: packages/aios-kernel/memory-manager/freshness-gate.mjs
  verify: node --check packages/aios-kernel/memory-manager/freshness-gate.mjs

surface capability_token
  lane: capability_security
  goal: Implement capability token shape, scope, expiry, delegation, and audit references.
  files: packages/aios-kernel/capability-security/capability-token.mjs
  verify: node --check packages/aios-kernel/capability-security/capability-token.mjs

surface capability_policy_evaluator
  lane: capability_security
  goal: Implement capability policy evaluator for syscall, file, shell, deploy, and external-write decisions.
  files: packages/aios-kernel/capability-security/policy-evaluator.mjs
  verify: node --check packages/aios-kernel/capability-security/policy-evaluator.mjs

surface capability_external_write_guard
  lane: capability_security
  goal: Implement external-write guard requiring explicit approval and draft-vs-send boundaries.
  files: packages/aios-kernel/capability-security/external-write-guard.mjs
  verify: node --check packages/aios-kernel/capability-security/external-write-guard.mjs

surface capability_destructive_action_guard
  lane: capability_security
  goal: Implement destructive-action guard for delete, deploy, privileged mutation, and irreversible operations.
  files: packages/aios-kernel/capability-security/destructive-action-guard.mjs
  verify: node --check packages/aios-kernel/capability-security/destructive-action-guard.mjs

surface capability_rate_limit
  lane: capability_security
  goal: Implement capability-aware rate limiting for model calls, external systems, and operator interrupts.
  files: packages/aios-kernel/capability-security/rate-limit.mjs
  verify: node --check packages/aios-kernel/capability-security/rate-limit.mjs

surface syscall_registry
  lane: syscall_layer
  goal: Implement builtin syscall registry and metadata for fs, shell, git, memory, verifier, claim, and audit syscalls.
  files: packages/aios-kernel/syscall-layer/syscall-registry.mjs
  verify: node --check packages/aios-kernel/syscall-layer/syscall-registry.mjs

surface syscall_fs_read
  lane: syscall_layer
  goal: Implement fs.read syscall contract with scope checks, path policy, and audit output.
  files: packages/aios-kernel/syscall-layer/fs-read.mjs
  verify: node --check packages/aios-kernel/syscall-layer/fs-read.mjs

surface syscall_fs_write
  lane: syscall_layer
  goal: Implement fs.write syscall contract with capability checks, artifact/product distinction, and audit output.
  files: packages/aios-kernel/syscall-layer/fs-write.mjs
  verify: node --check packages/aios-kernel/syscall-layer/fs-write.mjs

surface syscall_shell_exec
  lane: syscall_layer
  goal: Implement shell.exec syscall contract with sandbox policy, timeout, evidence capture, and risk labels.
  files: packages/aios-kernel/syscall-layer/shell-exec.mjs
  verify: node --check packages/aios-kernel/syscall-layer/shell-exec.mjs

surface claim_allowance
  lane: verifier_claim_gate
  goal: Implement claim allowance evaluation requiring verifier evidence, truth boundary, and contradiction checks.
  files: packages/aios-kernel/verifier-claim-gate/claim-allowance.mjs
  verify: node --check packages/aios-kernel/verifier-claim-gate/claim-allowance.mjs

surface verifier_result
  lane: verifier_claim_gate
  goal: Implement verifier result normalization and green/red evidence for boot/run/claim gates.
  files: packages/aios-kernel/verifier-claim-gate/verifier-result.mjs
  verify: node --check packages/aios-kernel/verifier-claim-gate/verifier-result.mjs

surface release_packet
  lane: verifier_claim_gate
  goal: Implement release packet assembly for hosted boot proof, claim gate, artifact bundle, and human review.
  files: packages/aios-kernel/verifier-claim-gate/release-packet.mjs
  verify: node --check packages/aios-kernel/verifier-claim-gate/release-packet.mjs
