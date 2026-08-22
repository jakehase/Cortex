# Focused repair wave for failed surfaces from run-20260702T003648Z.
# Truth boundary: repairs only the 8 failed AI OS language surfaces; does not claim boot-proof green unless verifier/threshold artifacts pass.

goal AIOSHostedKernelBootFailedSurfaceRepair
repo /root/clawd/ai-os
artifact_root artifacts/aios-v0/latest/failed_surface_repair_20260702
fidelity production_slice
benchmark_tier production_quality_repair_smoke
agents 8
stop failed_surfaces_repaired_or_blocker
allow read_repo, write_product_code, run_tests
forbid external_send, touch_prod, relaunch_benchmark
done failed_surfaces_repaired, no_truth_layer_overclaim
product_diff_mode: creative_product_work
require_real_product_diffs: true
creative_product_work: {"required":true,"promptMode":"compact","minIterations":1,"minWorkerRuntimeMs":0}
canonical_landing_evidence: {"enabled":true,"minAddedLineCount":1,"minUniqueNormalizedAddedLineCount":1,"duplicateLineRatioMax":0.55}

wave_policy
  max_waves: 2
  bundle_size: 1
  full_context_waves: 0
  handoff: wave_factpack

expansion_policy
  triggers: failed_surfaces, objective_red
  max_cycles: 1
  max_surfaces: 8
  strategy: repair_failed_surfaces

ai_os failed_surface_repair
  plan: /root/clawd/ai-os/plan.md
  kernel: hosted_linux
  owner: Jake
  process_model: job, process, thread, owner, exit_contract
  syscalls: fs.read, fs.write, shell.exec, git.diff, memory.search, memory.write, verifier.run, claim.submit, audit.write
  memory_mounts: project_memory, structural_memory, episodic_log, artifact_store
  evidence: repair_wave_summary.json, process_lifecycle.json, capability_audit.json, syscall_audit.json, claim_gate.json, artifact_bundle_manifest.json
  evidence_mode: deferred_boot_claim
  physical_wave_width: 8
  standard_heavy_wave_agent_count: 45
  active_codex_call_cap: 8
  global_call_budget: 8
  boot_commands: node apps/aios-cli.mjs boot --artifact-root artifacts/aios-v0/latest
  claim_gate: verifier_green_required
  truth_boundary: Failed-surface repair for hosted AI OS v0.1 only; do not claim native OS, production readiness, or boot-proof green unless the repair wave threshold passes.

surface operator_cli_boot
  lane: operator_userland
  goal: Repair the failed hosted boot command surface from run-20260702T003648Z: make boot orchestration, artifact-root initialization, and boot proof handoff syntactically valid and verifier-friendly.
  files: packages/aios-kernel/operator-userland/cli-boot.mjs
  verify: node --check packages/aios-kernel/operator-userland/cli-boot.mjs

surface scheduler_lease_manager
  lane: scheduler
  goal: Repair the failed lease manager surface from run-20260702T003648Z: worker leases, renewal, stale lease detection, and recovery-safe ownership contracts.
  files: packages/aios-kernel/scheduler/lease-manager.mjs
  verify: node --check packages/aios-kernel/scheduler/lease-manager.mjs

surface artifact_claim_evidence_link
  lane: artifact_filesystem
  goal: Repair the failed claim-to-evidence linking surface from run-20260702T003648Z so claims can trace required proof artifacts.
  files: packages/aios-kernel/artifact-filesystem/claim-evidence-link.mjs
  verify: node --check packages/aios-kernel/artifact-filesystem/claim-evidence-link.mjs

surface memory_mount
  lane: memory_manager
  goal: Repair the failed memory mount descriptor surface from run-20260702T003648Z for project, structural, episodic, artifact, and volatile memory mounts.
  files: packages/aios-kernel/memory-manager/memory-mount.mjs
  verify: node --check packages/aios-kernel/memory-manager/memory-mount.mjs

surface capability_external_write_guard
  lane: capability_security
  goal: Repair the failed external-write guard surface from run-20260702T003648Z with explicit approval and draft-vs-send boundaries.
  files: packages/aios-kernel/capability-security/external-write-guard.mjs
  verify: node --check packages/aios-kernel/capability-security/external-write-guard.mjs

surface capability_rate_limit
  lane: capability_security
  goal: Repair the failed capability-aware rate limit surface from run-20260702T003648Z for model calls, external systems, and operator interrupts.
  files: packages/aios-kernel/capability-security/rate-limit.mjs
  verify: node --check packages/aios-kernel/capability-security/rate-limit.mjs

surface syscall_fs_read
  lane: syscall_layer
  goal: Repair the failed fs.read syscall surface from run-20260702T003648Z with scope checks, path policy, and audit output.
  files: packages/aios-kernel/syscall-layer/fs-read.mjs
  verify: node --check packages/aios-kernel/syscall-layer/fs-read.mjs

surface claim_allowance
  lane: verifier_claim_gate
  goal: Repair the failed claim allowance surface from run-20260702T003648Z requiring verifier evidence, truth boundary, and contradiction checks.
  files: packages/aios-kernel/verifier-claim-gate/claim-allowance.mjs
  verify: node --check packages/aios-kernel/verifier-claim-gate/claim-allowance.mjs
