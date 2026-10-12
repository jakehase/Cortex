# Cortex Post-Audit Repair — plan

**Last updated:** 2026-10-11

## 1. Working name

Cortex Post-Audit Repair 2026-10-11

## 2. Core thesis / objective

Restore the current Cortex/OpenClaw system to the complete intended state defined by the October 11 read-only audit: preserve all later explicitly approved behavior, eliminate every confirmed audit finding, produce one reproducible immutable release, and prove the deployed system through an independent supervisor truth gate.

**Reply anchor:** Jake's October 11, 2026 instruction, “Fix everything you listed,” anchored to the immediately preceding full audit report.

**Fidelity:** `parity_for_scope` — every finding in the audit surface matrix must be fixed or stopped with an explicit blocker; this is not a claim that every aspirational Cortex roadmap item is complete.

**Implementation surface:** shared Cortex/OpenClaw product and control-plane code, deployment packaging, configuration, memory, health, tests, and operational units. Benchmark-only fixes are prohibited.

## 3. Scope

1. Capture and reconcile the exact live runtime into a reproducible source candidate.
2. Restore immutable-release provenance, accepted refs, manifests, rollback, and durable test evidence.
3. Repair required route-gate principal/session handling, including subagent routing and lifecycle callbacks.
4. Restore least privilege while preserving local Oracle/provider functionality.
5. Reconcile canonical policy files and memory with later approved OAuth/model decisions.
6. Unify readiness, Sentinel, Meta Conductor, per-level, parser, and provider-freshness truth semantics.
7. Correct memory conflict/supersession behavior and delegated-session lifecycle persistence.
8. Resolve PDF parser status, controlled-restart status noise, browser reliability regressions, stale timers/jobs, owner-index inefficiency, and AI OS evidence freshness.
9. Re-run one focused smoke after each independently deployable repair stage, then one clean full qualification on Hetzner against the exact candidate.
10. Deploy the exact qualified candidate, perform rollback proof, publish an authoritative accepted ref, and record final truth.

## 4. Non-goals

- No wholesale rollback to the August release.
- No deletion of approved September–October capabilities merely because they are weakly proven.
- No benchmark-only workaround.
- No expansion into unrelated roadmap features.
- No user-visible provider write, message, email, or post.
- No broad new test campaign beyond the final qualification and the one focused smoke per independently deployed repair stage.

## 5. Active path / repo layout

- **Control-plane project contract:** `/root/clawd/cortex-repair-20261011/`
- **Current accepted source baseline:** `origin/accepted/cortex-memory-lifecycle-v6.4-20261002` at `a828d0a027753c4ad089343ed7c599f3bc1cf26f`
- **Live runtime:** `/opt/cortex/current`
- **Canonical repair worktree:** `/root/clawd/_worktrees/cortex-repair-20261011` (to be created from the accepted source and overlaid with the exact live delta)
- **Remote execution mirror:** `/home/jake/clawd-remote/cortex-repair-20261011` on Hetzner `clawd-exec-hel1`
- **Evidence root:** `/root/clawd/artifacts/cortex-repair-20261011/`
- **Quarantine root:** `/root/clawd/_quarantine/cortex-repair-20261011/`

The dirty `/root/clawd` root worktree is not an implementation source for this repair. It remains a control-plane workspace until separately reconciled.

## 6. Prior art and existing assets

Decision: `extend_existing`.

Reuse:
- accepted release and deployment manifest machinery,
- Cortex route gate and memory bridge plugins,
- principal/signature helpers,
- systemd hardening and safe-mode capability guards,
- Sentinel and Meta Conductor health probes,
- memory lifecycle v6 temporal/supersession APIs,
- gateway code-manifest preflight,
- canonical Hetzner Codex worker launcher,
- detached supervisor/notifier conventions,
- AI OS adapter status/recovery substrate.

No parallel release, routing, memory, health, or notifier primitive will be created.

## 7. Target architecture

- One immutable, source-pinned Cortex release.
- OpenClaw remains mediation/runtime; Cortex remains reasoning, memory, routing, and cognition substrate.
- Required routing remains fail-closed for genuine trust/auth failures but does not block trusted internal subagents because of missing parent-principal propagation.
- Oracle provider execution runs in a narrowly privileged helper boundary rather than granting the whole Cortex API root-level write access to OpenClaw state.
- Safe mode remains default; external writes remain disabled.
- Canonical policy files contain only the latest approved OAuth/model decisions, with explicit supersession records for prior rules.
- Health surfaces share one machine-readable status vocabulary: operational, restricted-by-design, degraded, disabled-by-design, untested, stale-evidence, and failed.
- Memory preserves principal isolation while supporting trusted parent-to-subagent continuity and explicit temporal supersession.
- Tests, manifests, deployed hashes, rollback artifacts, and remote accepted refs all identify the same source tree.

## 8. Subsystem ownership matrix

- Release/provenance: source worktree, manifests, accepted refs, rollback.
- Routing/orchestration: route gate, Nexus orchestration, parent-principal propagation, failover timing.
- Security/runtime: systemd units, Oracle helper, filesystem and network permissions.
- Policy/identity: USER/TOOLS/MEMORY and Cortex fact supersession.
- Health/truth: readiness, Sentinel, Meta Conductor, registry, parser/provider freshness.
- Memory: bridge callbacks, temporal facts, conflicts, owner index scheduling.
- Operations: browser, timers, restart semantics, AI OS evidence.
- Verification: focused smokes, clean remote suite, security audit, rollback drill, deployment parity.

## 9. Agent strategy

- Control-plane work remains local and serialized.
- Heavy test and repo-scale qualification runs on Hetzner only.
- Up to six specialized remote workers may inspect or patch isolated branches after routing is repaired.
- Shared source writes are serialized through the canonical repair worktree.
- Every worker returns: changed paths, reasoning, one focused test, risks, and exact commit.
- No worker may deploy directly.

## 10. Phases / waves

### Phase 0 — Freeze and reproducibility

1. Snapshot exact live runtime hashes, active configuration metadata, unit files, and rollback pointers.
2. Create the clean repair worktree from the accepted October 2 source.
3. Overlay the exact live delta and identify generated/cache/private files that must not enter source.
4. Commit a `live-reconciled` baseline without claiming it is green.

Acceptance:
- Every live product file is either represented in source, explicitly generated, or quarantined with a reason.
- Candidate hash manifest reproduces the live runtime.
- Rollback to the currently running release is available before mutation.

### Phase 1 — Routing and delegated-session continuity

1. Reproduce the `/nexus/orchestrate` 403 under trusted subagents.
2. Propagate parent principal/session trust to subagent route and memory lifecycle hooks.
3. Define bounded failover and timeout behavior so one route outage cannot freeze WhatsApp for 450 seconds without an explicit error.
4. Verify required fail-closed behavior remains for forged/untrusted scopes.

Acceptance:
- Trusted subagent route checks and completion callbacks pass.
- Forged/missing trust is rejected.
- One spawned read-only worker completes end to end.
- Main-lane latency/failure smoke passes.

### Phase 2 — Least privilege

1. Separate Oracle/OpenClaw provider execution into the narrowest existing helper/service boundary.
2. Remove root/full-capability Cortex API execution where not required.
3. Restrict writable paths and egress to documented needs.
4. Re-run authorization and safe-mode checks.

Acceptance:
- Cortex API does not run with unnecessary root/full capabilities.
- Oracle provider calls still complete.
- OpenClaw auth/session/config writes are impossible from ordinary Cortex API code paths.
- Security audit and focused authorization smoke pass.

### Phase 3 — Canonical policy and memory truth

1. Update USER/TOOLS/MEMORY to the latest approved PMHNP OAuth and xhigh/default-service policy.
2. Write explicit supersession edges for the prior personal-OAuth and ultra policies.
3. Correct conflict classification so supporting facts do not become conflicts and superseded execution-plane facts do not remain co-equal current facts.
4. Repair trusted subagent memory lifecycle persistence.

Acceptance:
- Current policy queries return one current answer and historical facts as superseded/history.
- Static injected files agree with runtime.
- Principal isolation and PHI/privacy quarantine remain green.

### Phase 4 — Health, parser, browser, and operations truth

1. Unify status vocabulary and aggregation rules.
2. Distinguish safe-mode restrictions and stale provider receipts from actual failure.
3. Correct Meta Conductor, Sentinel, L23, L36, and parser truth.
4. Fix or intentionally disable the PDF parser with honest status.
5. Correct controlled-restart exit semantics.
6. Reduce owner-index timer work when no source changed.
7. Remove/quarantine stale reminder units and obsolete failed cron jobs.
8. Refresh AI OS evidence without broadening its authority.
9. Run a focused Cortex browser status/search smoke with fallback evidence.

Acceptance:
- Readiness, Sentinel, Meta Conductor, and level statuses agree on the same facts.
- No active component reports green when its required dependency failed.
- Restricted/disabled-by-design components do not lower operational health.
- Browser and AI OS boundaries remain intact.

### Phase 5 — Qualification and release

1. Sync exact candidate to Hetzner.
2. Run one clean full suite and the focused authorization/routing/memory/browser/restart checks against the exact commit.
3. Run independent supervisor checks over the surface matrix.
4. Build immutable release, source manifest, test receipt, security report, and rollback packet.
5. Deploy exact candidate, verify hashes, perform an actual rollback drill, redeploy exact candidate, and verify again.
6. Push authoritative branch and accepted ref.

Acceptance:
- All surface-matrix rows green.
- Full suite green on exact candidate.
- Live hashes equal candidate manifest.
- Rollback and redeploy green.
- Remote accepted ref resolves to deployed commit.

## 11. Verifier and evidence contract

Required evidence:
- live-baseline manifest,
- source reconciliation report,
- routing/subagent smoke,
- forged-principal negative test,
- least-privilege unit evidence,
- policy contradiction report,
- memory supersession/conflict tests,
- health-consistency report,
- parser/browser/AI OS focused smokes,
- full remote suite receipt,
- security audit,
- deployment manifest,
- rollback/redeploy receipt,
- final claim packet.

One smoke proves mechanical operation only. The final broad claim requires the full exact-candidate qualification and deployment-parity evidence.

## 12. Artifacts and replay commands

Artifacts live under `/root/clawd/artifacts/cortex-repair-20261011/` and must contain no secret values.

Replay commands will be written into the final release packet after the candidate path and commit exist. Heavy replay commands must target Hetzner, not CT101.

## 13. Stop condition

`supervisor_green_or_blocker_report`

The repair is complete only when every audit finding is green in the surface matrix and the exact deployed candidate passes the release contract. If a genuine blocker remains, stop with a blocker report naming the missing evidence, next action, and explicit statement that completion was not achieved.

## 14. Truth boundary

- Planning and manifests are not repairs.
- Passing focused tests is not whole-system green.
- A green source candidate is not a deployed release.
- A deployed release is not reproducible until the remote accepted ref, manifest, and rollback proof match it.
- Safe-mode restriction is not component failure; stale or synthetic status is not health proof.
- Existing historical evidence remains valid only for its original source and date.

## 15. Risks and mitigations

- **Mixed live source:** capture exact hashes before changes; use a clean worktree.
- **Service outage:** stage immutable releases and preserve rollback pointer.
- **Auth/session breakage:** negative tests plus current-session smoke before promotion.
- **Privacy leakage:** no secrets in artifacts; preserve scope signatures and quarantine.
- **Root privilege regression:** separate helper rather than broad writable paths.
- **Remote/local divergence:** hash manifests at sync and deployment.
- **Provider instability:** bounded retries and explicit blocker, not silent fallback.
- **Overclaiming:** supervisor reads machine artifacts, not worker prose.

## 16. Immediate next milestone

Complete Phase 0: create the clean worktree, capture and reconcile the exact live source, establish rollback, and produce the live-baseline manifest before touching behavior.

## Estimates

- Phase 0: 30–60 minutes, low compute.
- Phases 1–4: 3–8 hours depending on routing/security coupling, moderate model and test compute.
- Phase 5: 1–3 hours on Hetzner, high test compute.
- Expected total: 5–12 hours if no provider or architectural blocker appears.
