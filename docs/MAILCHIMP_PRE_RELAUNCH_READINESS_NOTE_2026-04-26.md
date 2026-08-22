# Mailchimp pre-relaunch readiness note — 2026-04-26

## Reply anchor
Jake said: “Do it. Let’s get everything done up u til the next relaunch.”

## Boundary honored
This prep stopped at the next relaunch boundary. No heavy Mailchimp relaunch or remote worker farm was started.

## Active path
- Workspace/control plane: `/root/clawd`
- Mailchimp product repo under workspace: `/root/clawd/mailchimp-clone`
- Shared stack: `/root/clawd/large-project-capability-stack`
- Heavy execution target remains VM102, not local CT101/PCT101:
  - host: `10.0.0.52`
  - user: `jake`
  - port: `22`
  - remote workdir: `/home/jake/clawd-remote`

## Commits prepared before relaunch
- `9545d7bf2` — Prepare Mailchimp parity relaunch surfaces
- `b9e344b8a` — Ignore generated benchmark guard artifacts
- `c198a75c0` — Add large project orchestration stack
- `ad98e3caf` — Harden Cortex completion and routing plugins
- `01ede73fc` — Harden Cortex benchmark truth surfaces
- `807deab4e` — Document relaunch guardrails and assistant ops skills

Earlier base commits still relevant:
- `09c7d1a5a` — Ignore local workspace scratch artifacts
- `22d498715` — Fix Mailchimp audit truth accounting

## Quarantine performed
Generated/scratch leftovers were moved, not deleted:
- `public/cortex_server/cortex_server/knowledge/evolution/changelog.txt`
- `public/cortex_server/cortex_server/knowledge/evolution/diplomat_log.txt`
- `public/cortex_server/cortex_server/knowledge/evolution/skill_registry.json`
- `tmp/watch_pmhnp_tier2.sh`

Recovery note/manifest:
- `_quarantine/2026-04-26-pre-relaunch-generated-leftovers/manifest.json`

Reason: these were generated Cortex evolution logs and stale PMHNP watcher scratch, not active implementation paths for the Mailchimp relaunch boundary.

## Validation results
Passed:
- `git diff --check`
- `node --test plugins/completion-integrity/core.test.mjs plugins/cortex-route-gate/creativity-governor.test.mjs plugins/cortex-memory-bridge/index.test.mjs` — `40/40`
- `cd public/cortex_server && python3 -m pytest tests/test_librarian_recall_fallback.py tests/test_meta_conductor_kernel_v2_integration.py tests/test_nexus_forced_chains.py tests/test_cortex_audit_honesty_fixes.py tests/test_evidence_traceability.py tests/test_mailchimp_parity_supervisor.py tests/test_mailchimp_program1_supervisor.py` — `28 passed`
- `cd large-project-capability-stack && npm test` — `60/60`
- syntax/format spot checks for helper scripts:
  - `bash -n scripts/autocommit-cortex.sh`
  - `node --check scripts/quarantine-paths.mjs`
  - `node --check scripts/patch-openclaw-whatsapp-thread-bound-sessions-2026-4-5-staging.mjs`
  - `node --check scripts/test-openclaw-2026-4-5-thread-binding-fallback.mjs`

Known not-green gate:
- `cd large-project-capability-stack && npm run architecture:check` still reports `ok: false` because of `anti-collapse-max-lines` on:
  - `apps/orchestrator-qualification/run.mjs`
  - `apps/system-benchmark/run-transfer-orchestrator-benchmark.mjs`
  - `apps/system-benchmark/verify-pmhnp-functional-scenario.mjs`
  - `packages/campaign-runtime/index.mjs`
  - `packages/multi-agent-orchestrator/index.mjs`
  - `packages/system-benchmark/index.mjs`

The architecture check budget and surface-honesty sections are otherwise green in the latest run, but the max-line rule remains a pre-relaunch warning/blocker depending on how strict the next launch gate is.

## Current repo state at note time
- Worktree was clean after quarantine and commits.
- Remote export/push remains unresolved because GitHub auth previously failed over HTTPS and SSH.
- Do not update remote `main`/`master` until divergence and auth are handled.

## Recommended next action
Before launching the next Mailchimp run, decide whether the remaining `anti-collapse-max-lines` architecture violations are launch-blocking. If strict architecture green is required, split those six files first. If not, proceed only with VM102-bound launch mechanics and preserve the relaunch contract/stop condition: `supervisor_green_or_blocker_report`.
