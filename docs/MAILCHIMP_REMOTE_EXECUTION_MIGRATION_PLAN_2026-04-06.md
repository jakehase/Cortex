# Mailchimp orchestration migration plan — 2026-04-06

## Reply anchor
Jake asked to do both of these:
1. write the exact migration patch plan for moving Mailchimp orchestration from PCT101 to VM102
2. start implementing the first step so PCT101 becomes a thin control plane and future tasks keep this architecture in mind

## Target paths
- `/root/clawd/mailchimp-clone`
- `/root/clawd/large-project-capability-stack`
- `/root/clawd/AGENTS.md`

## Fidelity
- `production_slice` for the architecture guardrails and notifier hardening
- future migration target remains `parity_for_scope` for the execution architecture and `full_clone` for the Mailchimp product campaign

## Scope
- thin control-plane rule on PCT101
- heavy execution moved to VM102
- blocker-aware notifier behavior
- machine-readable execution-boundary policy
- future-task architecture rule

## Desired architecture

### PCT101 / CT101 / control plane
Responsibilities:
- WhatsApp / OpenClaw gateway
- lightweight Cortex reasoning/routing for chat
- supervisor
- notifier
- artifact consumer
- fail-fast preflight

Must not run:
- local multiprocess worker farms
- browser-heavy validation
- repo-scale qualification
- large local test farms

### VM102 / execution plane
Responsibilities:
- heavy orchestration
- real worker farm
- browser validation
- repo-scale qualification
- large test execution
- authoritative heavy-run artifacts

## Hard rule
If a task needs heavy multi-agent orchestration, browser-heavy validation, or repo-scale qualification, the control-plane host must not run it locally.

If the remote execution boundary is missing, the system must:
1. stop before spawning the heavy workload
2. write a structured blocker
3. notify via the lightweight control plane

## Patch plan

### Phase 1 — enforce the boundary on PCT101
Implemented in this pass:
- add machine-readable execution policy: `mailchimp-clone/execution-boundary-policy.json`
- add architecture helper: `scripts/lib/full-audit-campaign-architecture.mjs`
- block local 100-agent launch on the control plane before delegate spawn
- write structured blocker artifacts instead of silently burning RAM
- prepare execution-plane runner scaffold: `scripts/full-audit-campaign-remote-runner.mjs`

### Phase 2 — make notifications truthful and blocker-aware
Implemented in this pass:
- notifier now delivers blocker outcomes, not only green completions
- watcher now triggers notify when stop condition is reached by blocker as well as green
- supervisor marks notification work as pending for blocker states too

### Phase 3 — provision VM102 execution plane
Still required:
- deploy `mailchimp-clone` on VM102
- deploy `large-project-capability-stack` on VM102
- set `MAILCHIMP_HOST_ROLE=execution_plane` on VM102 runner environment
- validate Node/runtime/test dependencies there
- decide authoritative artifact exchange:
  - shared artifact root, or
  - mirrored summary/blocker sync back to PCT101

### Phase 4 — add real remote submission boundary
Implemented in this pass as a code path, but not yet activated against VM102:
- control plane can now use SSH-based remote submission when `remoteExecution.enabled=true`
- control plane mirrors back remote execution artifacts (`completion_summary.json`, `program_state.json`, `blocker_report.json`, remote execution status/log) for supervisor reconciliation
- incomplete remote config now produces a structured blocker instead of falling back to local heavy execution

Still required before live activation:
- enable `remoteExecution` in `execution-boundary-policy.json`
- configure host/user/key/workdir/sharedArtifactRoot
- verify VM102 SSH access and runtime dependencies
- then relaunch from PCT101 as watch + notify only

Current blocker observed from CT101 on 2026-04-06:
- `ssh -i /root/.ssh/id_ed25519 -o BatchMode=yes root@10.0.0.52 ...` returns `Permission denied (publickey)`
- no `~/.ssh/proxmox_key` is present on this host right now
- so the remote submission code path exists, but honest live activation is blocked on access

### Phase 5 — generalize the rule beyond Mailchimp
Implemented partly in this pass:
- add a hard rule to `AGENTS.md`

Still recommended:
- create a reusable shared runtime policy package for all future long-run campaigns
- require explicit host-role declaration for heavy campaigns
- require fail-fast structured blocker when a thin-control-plane rule would be violated

## Stop condition for this migration slice
This slice stops when:
- control-plane local heavy launch is refused by policy
- blocker artifacts are written truthfully
- notifier can deliver blocker outcomes
- architecture rule is documented for future tasks

## What is not yet complete
- VM102 is not yet wired as the active heavy runner
- remote submission is not yet live from this host
- authoritative shared-artifact plumbing is not yet configured
- the Mailchimp full-clone campaign itself is not completed by this architecture slice
