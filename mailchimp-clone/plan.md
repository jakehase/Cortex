# Mailchimp Full-Parity Completion Plan

Template source: `/root/clawd/docs/PROJECT_PLAN_TEMPLATE.md`.

This plan uses the workspace-wide serious-project `plan.md` standard for completing the current Mailchimp clone progress toward honest full parity.

## Plan metadata

- Project slug: `mailchimp-clone-full-parity`
- Plan owner: `Jake + Cortex`
- Created: `2026-06-30`
- Last updated: `2026-06-30`
- Status: `draft_active`
- Fidelity target: `full_clone`
- Primary stop condition: `parity_matrix_green_or_gap_inventory`
- Secondary stop condition: `supervisor_green_or_blocker_report`
- Status file: `/root/clawd/mailchimp-clone/STATUS.md`
- Decisions log: `/root/clawd/mailchimp-clone/DECISIONS.md`
- Plan index entry: `/root/clawd/docs/PLAN_INDEX.md`

## Planning lifecycle guard

- Keep this `plan.md` strategic: objective, architecture, phases, stop condition, and truth boundary.
- Keep current checkpoint/blockers/next actions in `/root/clawd/mailchimp-clone/STATUS.md`.
- Keep durable choices and supersession notes in `/root/clawd/mailchimp-clone/DECISIONS.md`.
- Treat benchmark artifact `repo/`, `repo_baseline/`, and old dated Mailchimp plans as evidence/historical unless this plan or `/root/clawd/docs/PLAN_INDEX.md` explicitly promotes them.

## 1. Working name

**Mailchimp Full-Parity Completion**

## 2. Decision summary

Complete the existing Mailchimp clone work from the latest 100-agent real-parity run toward honest full parity, using the project planning template as the control contract. The immediate milestone is not to blindly resume agents; it is to reconcile the latest artifacts, close the one currently known executable negative-space item, rerun a fresh full-clone inventory, and only then continue with additional parity tranches if the inventory finds more gaps.

Observed anchor:

```text
Remote artifact root:
/home/jake/clawd-remote/large-project-capability-stack/artifacts/benchmarks/mailchimp_100agent_real_parity_240m_noholdback/mailchimp-real-parity-100agent-noholdback-4h-real-launch-20260625T052039Z
```

Latest observed root artifact state on `2026-06-30`:

- `completion_summary.status=paused_budget_backoff`
- `thresholdPass=false`
- `mechanicalGreen=false`
- `scaleProofReady=true`
- `uniqueAgentCount=100`
- `waveCount=24`
- `totalShards=2400`
- `mergedShardCount=2194`
- `changedProductFileCount=122`
- `addedLineCount=340111`
- `uniqueNormalizedAddedLineCount=184406`
- `tokensObserved=189143272`
- `autonomyWindowMinutes=491.21`
- completion artifact reports `remainingExecutableSurfaceCount=1`
- completion artifact reports `negativeSpaceOpenCount=1`
- remaining known item: `objective_truth_negative_space__email_marketing_campaigns_phase10_negative_space`
- completion artifact reports production quality red because `duplicateNormalizedLineRatio=0.18113921390037133` exceeds `<=0.18`, though `production_quality_gate.json` currently says `ok=true`; this contradiction must be reconciled before any pass claim.

This plan does **not** claim Mailchimp full parity yet.

## 3. Core thesis / objective

Primary objective:

- Finish the Mailchimp clone to a defensible full-parity claim, not merely a scoped benchmark green.

User/operator served:

- Jake as owner/operator of the workspace and agent orchestration system.

Desired outcome:

- A Mailchimp clone whose full-parity claim is backed by a fresh surface inventory, source-backed product implementation, production quality gates, replayable artifacts, and explicit remaining-gap status.

Why existing artifacts are insufficient by themselves:

- The current run is high-scale and productive, but `thresholdPass=false` and full parity is not proven.
- The currently known queue has one executable negative-space item, but one known remaining item is not the same as exhaustive full-product parity.
- Previous project memory explicitly warns that scoped matrix green, strict-gap green, objective-truth green, raw LOC, and scale proof must not be collapsed into full clone completion.

Success changes:

- We can honestly say either:
  - `Mailchimp full parity achieved for the current source inventory`, or
  - `Mailchimp full parity remains blocked`, with a concrete gap inventory and next tranche.

## 4. Scope

In scope:

- Reconcile latest Mailchimp remote artifacts and sync local canonical copies.
- Close the currently known executable negative-space item for email marketing campaigns phase 10.
- Reconcile production-quality artifact contradiction.
- Rerun fresh full-clone gap inventory after the known queue is closed.
- Implement additional source-backed parity tranches discovered by the fresh inventory.
- Maintain token usage estimates and actual token usage ledger per tranche.
- Preserve truthful distinctions among scale proof, benchmark threshold pass, product parity, and full clone.

## 5. Non-goals

Out of scope for this plan:

- Claiming full parity from the current paused run.
- Claiming full parity from raw LOC volume.
- Claiming full parity from `scaleProofReady=true`.
- Claiming full parity from closing only the one currently known negative-space item.
- Public deployment, publishing, or external user-facing launch.
- Replacing real Mailchimp external services with unsafe live integrations.
- Running heavy 100-agent campaigns on the OpenClaw control-plane host.

Eventual ambition:

- Full Mailchimp product parity.

Current milestone:

- Close known remaining queue item + produce fresh gap inventory that either proves no remaining gaps or yields the next tranche.

## 6. Active path / repo layout

Active product path:

```text
/root/clawd/mailchimp-clone
```

Shared orchestration/control-plane path:

```text
/root/clawd/large-project-capability-stack
```

Preferred heavy execution plane:

```text
jake@37.27.129.239:/home/jake/clawd-remote
```

Current remote artifact anchor:

```text
/home/jake/clawd-remote/large-project-capability-stack/artifacts/benchmarks/mailchimp_100agent_real_parity_240m_noholdback/mailchimp-real-parity-100agent-noholdback-4h-real-launch-20260625T052039Z
```

Quarantined or superseded paths:

```text
/root/clawd/_quarantine/mailchimp-*                    # stale/contaminated/old recovery paths
/root/clawd/_rerun_workspace_*/mailchimp-clone         # scratch rerun workspaces, not canonical unless explicitly promoted
VM102 execution plane                                  # avoid for serious new heavy work while local Proxmox storage risk remains
```

Path rules:

- Product implementation lands in `/root/clawd/mailchimp-clone` or a deliberate remote mirror synced back to it.
- Shared orchestration fixes land in `/root/clawd/large-project-capability-stack`.
- Heavy runs happen on Hetzner unless Jake explicitly approves a local exception.
- Scratch workspaces do not become canonical without promotion evidence.

## 7. Prior art and existing assets

Prior-art gate decision: `extend_existing`

Existing assets to reuse/extend:

- Current Mailchimp clone product code in `/root/clawd/mailchimp-clone`.
- Shared multi-agent orchestrator and benchmark stack in `/root/clawd/large-project-capability-stack`.
- Existing Mailchimp full-clone supervisors, strict 1:1 supervisors, objective-truth repair flows, negative-space inventory, production-quality gate, and full-audit campaign runner.
- Latest 100-agent real-parity artifact root on Hetzner.
- Project memory in `/root/clawd/memory/projects/mailchimp.md` and `/root/clawd/memory/projects/mailchimp-clone.md`.

Known overlaps or duplication risks:

- Creating a new Mailchimp planner instead of extending existing objective-truth/negative-space/full-clone supervisors.
- Treating artifact green for a bounded benchmark as product full parity.
- Reusing stale VM102 or scratch workspace truth as current canonical state.

Decision:

- Extend the existing Mailchimp control-plane/supervisor path.
- Add or repair only the inventory, quality, and artifact truth needed to support the next full-parity tranche.

## 8. Target architecture

Architecture summary:

Mailchimp full parity should be driven by a loop of source inventory -> surface matrix -> owned product shards -> verifier/admission -> artifact/claim gate -> fresh inventory. The controller must keep expanding from the full-clone objective until the supervisor is green or a blocker proves why it cannot continue.

Subsystems:

- **Product runtime** — Mailchimp clone app/domain/routes/tests under `/root/clawd/mailchimp-clone`.
- **Surface inventory** — source-backed matrix of Mailchimp product surfaces, phase9 leaves, strict global gaps, and negative-space items.
- **Planner/controller** — selects actionable work bundles from remaining surface inventory.
- **Worker/admission path** — creates source-backed product changes and rejects no-diff or docs-only work.
- **Verifier catalog** — runs targeted tests, syntax/import checks, product quality gates, and inventory checks.
- **Claim gate** — decides which claims are allowed from artifacts.
- **Token ledger** — records observed tokens per wave/tranche and compares estimates to actuals.

Key boundaries:

- Control plane vs execution plane: chat/supervisor/artifact review stays local; 100-agent execution runs on Hetzner.
- Product implementation vs orchestration scaffolding: docs/tests/harness-only changes do not count as product parity unless they are the target surface.
- Known queue completion vs exhaustive parity: the last known queue item closing is followed by fresh inventory before a full-parity claim.

Interface contracts:

```text
completion_summary.json        # current benchmark/pass/blocker truth
threshold_evaluation.json      # threshold gate truth
actionable_gap_inventory.json  # fresh full-clone gaps and negative-space queue
production_quality_gate.json   # duplicate, regression, quality, and integration gate
claim_gate.json                # allowed/blocked user-facing claims
token_usage_ledger.json        # estimate vs actual token usage by tranche
```

Architecture decisions:

| Decision | Options considered | Chosen option | Reason | Revisit when |
|---|---|---|---|---|
| Execution plane | local, VM102, Hetzner | Hetzner | avoids overloading control plane and local storage risk | Hetzner unavailable or Jake approves local exception |
| Parity stop condition | last queue item, supervisor green, fresh inventory green | fresh inventory green + supervisor/claim gate green | avoids fake full parity from stale/limited queue | inventory model changes |
| Token budgeting | single exact estimate, scenario ranges | scenario ranges + actual ledger | token usage is volatile and model/provider limited | after each tranche |

## 9. Surface matrix / subsystem ownership

| Surface / subsystem | Owner / agent squad | Primary files | Allowed write scope | Verifiers | Claim allowed when |
|---|---|---|---|---|---|
| Email campaigns negative-space item | targeted product squad | `packages/app/domain-campaigns.mjs`, `packages/app/routes/campaigns.mjs`, campaign tests | campaign domain/routes/tests only unless lease expands | `node --test tests/campaign-editor-depth.test.mjs`, `node --test tests/phase9-campaign-parity.test.mjs` | known remaining item is closed and credited |
| Production quality reconciliation | quality/audit squad | quality gate scripts + product diff audit artifacts | quality gate code/artifacts; product cleanup only if source-backed | production quality gate rerun, duplicate audit, regression suite | quality contradiction resolved and root artifacts agree |
| Fresh full-clone inventory | inventory squad | inventory scripts/artifacts | read-only product scan + generated inventory artifacts | full-clone inventory command + artifact bundle | inventory yields zero gaps or actionable next tranche |
| Additional parity tranche | implementation squads | files named by inventory | leased product files only | targeted tests + admission + quality gate | tranche surfaces green in matrix |
| Release/claim gate | release/audit squad | claim gate, release packet, summary docs | artifacts/docs only | claim gate + replay commands | full-parity claim wording is allowed |

Ownership rules:

- Agents may only edit owned files/surfaces unless a lease/merge gate expands scope.
- Shared files require explicit lease or patch queue.
- No product credit for docs/tests/harness-only changes unless those are the target surfaces.
- Full parity requires source-backed behavior, not marker files or generated bloat.

## 10. Agent strategy

Agent count target: staged range from `5` to `100` depending on phase.

Execution placement:

- Control plane: `/root/clawd` on OpenClaw host
- Execution plane: `jake@37.27.129.239:/home/jake/clawd-remote`
- Remote boundary required? `yes` for multi-agent/heavy validation
- Heavy execution allowed locally? `no` by default

Agent roles:

- planner: select remaining surfaces and estimate token budget.
- implementer: land product-surface code for assigned owned files.
- verifier: run target tests, syntax/import checks, and production-quality gates.
- reviewer: inspect semantic parity and reject fake-green/no-diff work.
- release/audit: assemble artifacts, claim gate, replay commands, and token ledger.

Launch gates before using many agents:

- [ ] active path resolved and synced to Hetzner
- [ ] latest artifact root copied/summarized locally
- [ ] surface matrix or next-work queue exists
- [ ] file ownership/lease strategy exists
- [ ] verifier catalog exists
- [ ] artifact return contract exists
- [ ] token budget estimate exists for the tranche
- [ ] blocker format exists
- [ ] stop condition is artifact-backed
- [ ] execution plane is healthy

## 11. Phases / waves

### Wave 0 — Artifact sync and truth reconciliation

Goal:

- Create a local canonical proof bundle from the latest remote run and reconcile contradictions before resuming.

Inputs:

- Remote artifact root from `20260625T052039Z`.
- Current local `/root/clawd/mailchimp-clone` state.
- Project memory.

Outputs:

- `artifacts/mailchimp_full_parity_plan/latest/current_state_summary.json`
- `artifacts/mailchimp_full_parity_plan/latest/token_budget_estimate.json`
- `artifacts/mailchimp_full_parity_plan/latest/artifact_truth_reconciliation.md`

Verifiers:

```bash
# exact commands should be written after syncing the latest artifact root locally
node --check <reconciliation-script>
```

Stop condition:

```text
artifact_truth_reconciled_or_blocker_report
```

Estimated token usage:

- Planning/reconciliation only: `0.25M-1.5M` model tokens.
- If agent reviewers are used: `1M-3M` tokens.

### Wave 1 — Close the one currently known executable negative-space item

Goal:

- Implement/verify `objective_truth_negative_space__email_marketing_campaigns_phase10_negative_space` without overclaiming full parity.

Inputs:

- `continuous_controller_state.json` next-work queue.
- Allowed files:
  - `packages/app/domain-campaigns.mjs`
  - `packages/app/routes/campaigns.mjs`
  - `tests/campaign-editor-depth.test.mjs`
  - `tests/phase9-campaign-parity.test.mjs`

Outputs:

- Product patch touching source-backed campaign files.
- Targeted verifier output.
- Updated objective-truth artifact with the known queue item closed.

Verifiers:

```bash
node --test tests/campaign-editor-depth.test.mjs
node --test tests/phase9-campaign-parity.test.mjs
```

Stop condition:

```text
known_negative_space_item_green_or_blocker_report
```

Estimated token usage:

- Targeted 5-20 agent repair: `2M-8M` tokens.
- Conservative 100-agent-compatible repair wave: `8M-15M` tokens.
- Use targeted mode unless the claim being proven specifically requires another 100-agent wave.

### Wave 2 — Production quality reconciliation

Goal:

- Resolve the contradiction where the root completion summary reports production quality red, while `production_quality_gate.json` reports `ok=true`.

Inputs:

- `completion_summary.json`
- `threshold_evaluation.json`
- `production_quality_gate.json`
- current repo diff and duplicate audit

Outputs:

- Recomputed production quality gate.
- Root completion/threshold artifacts refreshed or blocker written.
- Duplicate normalized line ratio below policy threshold or documented blocker.

Verifiers:

```bash
npm test
<production-quality-gate-command>
<duplicate-normalized-line-audit-command>
```

Stop condition:

```text
production_quality_green_and_artifacts_consistent_or_blocker_report
```

Estimated token usage:

- Audit-only: `0.5M-2M` tokens.
- If cleanup patches are needed: `3M-12M` tokens.

### Wave 3 — Fresh full-clone inventory

Goal:

- Determine whether closing the known queue item actually reaches full parity or merely exposes the next tranche.

Inputs:

- Updated product repo after Waves 1-2.
- Current source-backed Mailchimp surface catalog.
- Existing strict 1:1, phase9, negative-space, and objective-truth inventories.

Outputs:

- Fresh full-clone gap inventory.
- Surface matrix with open/green/blocked states.
- Negative-space inventory.
- Claim gate decision.

Verifiers:

```bash
<full-clone-gap-inventory-command>
<strict-1to1-supervisor-command>
<objective-truth-supervisor-command>
```

Stop condition:

```text
parity_matrix_green_or_gap_inventory
```

Estimated token usage:

- Inventory/audit only: `2M-8M` tokens.
- With semantic reviewer agents/source comparison: `10M-35M` tokens.

### Wave 4 — Additional parity tranches if fresh inventory remains red

Goal:

- Continue through source-backed remaining gaps until the full-clone inventory is green or a real blocker is documented.

Inputs:

- Fresh gap inventory from Wave 3.
- Surface ownership matrix.
- Token budget per tranche.

Outputs:

- Product patches for each tranche.
- Targeted verifier results.
- Updated parity matrix.
- Token ledger actuals.

Verifiers:

```bash
<targeted-test-command-per-surface>
npm test
<production-quality-gate-command>
<claim-gate-command>
```

Stop condition:

```text
all_tranche_surfaces_green_or_blocker_report
```

Estimated token usage:

- Per small targeted tranche, 5-10 surfaces: `10M-40M` tokens.
- Per 100-agent broad wave, based on observed current run: `~7.9M tokens/wave` average, but practical total with retries/reviews is `8M-20M` per wave.
- Per 100 selected surfaces, based on current run: `~8M-20M` tokens depending on verifier/retry rate.

### Wave 5 — Full-parity release candidate packet

Goal:

- Produce the final truth packet if and only if all required parity gates are green.

Inputs:

- Latest green inventory.
- Production-quality gate.
- Supervisor/claim gate.
- Token ledger.

Outputs:

- `release_packet.json`
- `release_packet.md`
- `artifact_bundle_manifest.json`
- `claim_gate.json`
- final `token_usage_ledger.json`

Verifiers:

```bash
<release-packet-command>
<claim-gate-command>
<replay-validation-command>
```

Stop condition:

```text
release_candidate_packet_green_or_blocker
```

Estimated token usage:

- Audit/release only: `1M-5M` tokens.
- With independent reviewer agents: `5M-20M` tokens.

## 12. Token usage estimate contract

Observed baseline from latest remote run:

```text
tokensObserved: 189,143,272
waveCount: 24
totalShards: 2,400
mergedShardCount: 2,194
changedProductFileCount: 122
addedLineCount: 340,111
uniqueNormalizedAddedLineCount: 184,406
autonomyWindowMinutes: 491.21
uniqueAgentCount: 100
```

Derived rough rates:

```text
~7.88M tokens per 100-surface wave
~78.8k tokens per planned shard
~86.2k tokens per merged shard
~1.55M tokens per changed product file
```

These are planning rates, not guarantees. They include the behavior of this run shape, model/provider usage limits, verifier churn, rejections, retries, and possibly repetitive generation.

Scenario estimates from current state:

| Scenario | What must be true | Incremental token estimate | Total observed+future estimate |
|---|---|---:|---:|
| Finish current benchmark objective only | one known negative-space item closes, quality artifacts reconcile, fresh inventory finds no new gaps | `15M-60M` | `204M-249M` |
| Honest source-inventory full parity, modest new gaps | fresh inventory finds ~10-40 additional actionable gaps | `75M-250M` | `264M-439M` |
| Realistic Mailchimp-scale parity hardening | fresh inventory finds broad UI/data/integration/ops gaps needing multiple tranches | `250M-900M` | `439M-1.09B` |
| Strict full product parity with deep reviewers | independent parity review expands scope substantially | `900M-3B+` | `1.09B-3.19B+` |

Recommendation:

- Budget the next milestone, not the whole dream, as `20M-60M` tokens.
- Do not authorize a `500M+` token campaign until Wave 3 produces a fresh gap inventory showing the remaining surface count.
- Record actual token usage after every wave in `token_usage_ledger.json` and re-estimate from observed rates.

## 13. Verifier and evidence contract

Required verifiers:

```bash
node --test tests/campaign-editor-depth.test.mjs
node --test tests/phase9-campaign-parity.test.mjs
npm test
<production-quality-gate-command>
<full-clone-gap-inventory-command>
<claim-gate-command>
```

Evidence artifacts:

```text
completion_summary.json                 # current pass/blocker truth
threshold_evaluation.json               # benchmark threshold truth
continuous_controller_state.json         # next work queue / objective truth
production_quality_gate.json             # quality gate truth
actionable_gap_inventory.json            # fresh remaining gap truth
surface_matrix.json                      # surface completion truth
claim_gate.json                          # allowed wording
release_packet.json                      # final evidence bundle
token_usage_ledger.json                  # estimate vs actual token usage
```

Claim matrix:

| Claim | Required evidence | Verifier | Allowed wording |
|---|---|---|---|
| current run was productive | 2,194 merged shards, 122 product files, 189M observed tokens | completion summary | “productive high-scale run” |
| current run passed | `thresholdPass=true` | threshold evaluation | blocked now; not allowed |
| known remaining queue item closed | objective-truth state shows item credited | targeted campaign tests | “known queue item closed” |
| full parity achieved | fresh inventory green, supervisor green, production quality green, claim gate green | full clone inventory + claim gate | “full parity achieved for current inventory” |
| public/production readiness | deployment/security/ops evidence | separate release/ops gates | not in this plan |

A claim is green only when:

- The relevant artifact exists.
- The artifact is current for the active path.
- The claim gate maps the artifact to the exact wording.
- Contradictory artifacts are reconciled or explicitly blocked.

A blocker must be written when:

- Codex usage limit is active and a resume would waste calls.
- The next-work queue is empty but full inventory remains red.
- Production quality remains red.
- A fresh inventory discovers scope beyond the budgeted tranche.
- Execution boundary cannot be verified.

## 14. Capability, safety, and external-action policy

Capability matrix:

| Capability | Default | Requires approval? | Audit artifact | Revocation / rollback |
|---|---|---|---|---|
| read workspace artifacts | allowed | no | artifact summary | n/a |
| write local plan/artifacts | allowed | no | git diff/file review | revert file |
| run targeted local tests | allowed | no | test logs | n/a |
| run heavy 100-agent remote campaign | gated | yes unless already explicitly requested | run contract + launch log | stop/kill + blocker |
| external deploy/send/public launch | blocked | yes | approval artifact | rollback/deploy revert |

Safety rules:

- No external user-visible action without explicit approval.
- No destructive action without explicit approval and rollback/backup plan.
- No secrets in logs, plans, artifacts, or memory.
- If safety and completion conflict, stop and write a blocker.

## 15. Artifacts and replay commands

Canonical planning artifact root:

```text
/root/clawd/mailchimp-clone/artifacts/full_parity_plan/latest
```

Expected artifacts:

```text
current_state_summary.json
token_budget_estimate.json
artifact_truth_reconciliation.md
actionable_gap_inventory.json
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
```

Replay commands:

```bash
# Fill in exact commands after Wave 0 artifact sync/reconciliation.
# The existing current remote root should be treated as the source of truth until synced locally.
```

Artifact integrity requirements:

- Copy latest remote artifacts locally before final reporting.
- Preserve remote and local paths in summaries.
- Include token estimates and actuals in each tranche summary.
- Do not overwrite prior run artifacts without backup.

## 16. Stop condition

The project/phase stops when:

```text
parity_matrix_green_or_gap_inventory
```

Full-parity completion requires all of:

- fresh full-clone inventory green,
- supervisor green,
- `thresholdPass=true` for the declared benchmark claim if a benchmark claim is being made,
- production quality green with no contradictory root artifact,
- negative-space queue `0` open,
- no remaining executable surfaces,
- claim gate allows the exact wording,
- release packet and replay commands exist.

If stopped by blocker, write:

```text
/root/clawd/mailchimp-clone/artifacts/full_parity_plan/latest/blocker_report.json
```

Completion is not allowed merely because:

- agents finished,
- code exists,
- raw LOC is large,
- scale proof is green,
- the last known queue item is closed,
- a scoped matrix is green,
- a benchmark is green for a narrower claim.

## 17. Truth boundary

This plan may claim:

- The latest observed run is productive, high-scale, and artifact-rich.
- The latest observed run is not a threshold pass and not full parity.
- One executable negative-space item is currently known from the observed controller state.
- Token estimates are scenario ranges based on observed token rates.

This plan may **not** claim yet:

- Mailchimp full parity.
- Production readiness.
- Public deployment readiness.
- That closing the known queue item completes all Mailchimp parity.
- That 189M tokens bought deep architecture by itself.
- That `scaleProofReady=true` is product parity.

Truth layers to keep separate:

- planning/scaffolding,
- product implementation,
- tests/verifiers,
- mechanical green,
- threshold pass,
- scale proof,
- source-inventory parity,
- full clone,
- production/public readiness.

## 18. Risks and mitigations

| Risk | Why it matters | Mitigation | Evidence mitigation works |
|---|---|---|---|
| Last known queue item is mistaken for full parity | would create fake full-completion claim | always rerun fresh full-clone inventory after closing queue | fresh inventory artifact |
| Production quality artifact contradiction | pass claim could rely on stale or conflicting quality state | reconcile `completion_summary` vs `production_quality_gate` before resuming | reconciliation artifact + refreshed root summary |
| Token overrun | 100-agent waves can burn millions quickly | use staged budget gates and token ledger | `token_usage_ledger.json` |
| Codex usage limits | can pause/strand runs | obey observed backoff; no blind resumes | blocker/resume artifacts |
| Repetitive generated bulk | raw LOC can look impressive while shallow | duplicate/semantic audits and reviewer checks | production quality + semantic audit |
| Stale local artifacts | local root is not synced for latest run | read remote source of truth and sync before final claims | artifact bundle manifest |
| Execution-plane drift | remote code may diverge from local | dependency sync manifest and SHA checks | sync manifest |
| Over-broad 100-agent collision | shared file conflicts and no-diff work | ownership matrix + leases + admission gate | patch queue/admission reports |

## 19. Open questions

| Question | Why it matters | Owner | Needed by | Resolution artifact |
|---|---|---|---|---|
| What exact command should be canonical for fresh full-clone inventory after this run? | replayability | Cortex | Wave 0 | `verifier_catalog.json` |
| Is `production_quality_gate.json ok=true` newer or stale relative to completion quality failures? | claim truth | Cortex | Wave 2 | `artifact_truth_reconciliation.md` |
| After the known email campaign item closes, does fresh inventory find more gaps? | full parity scope | inventory squad | Wave 3 | `actionable_gap_inventory.json` |
| What token ceiling should Jake approve for the next tranche? | cost/control | Jake | before Wave 4 | `run_contract.json` |

Do not block Wave 0 on these questions. Do block heavy execution if the answer changes safety, architecture, active path, or stop condition.

## 20. Immediate next milestone

Next milestone:

- Produce a local `full_parity_plan/latest` artifact bundle containing current-state summary, token budget estimate, artifact truth reconciliation, and the exact replay/verifier commands for Waves 1-3.

Next action:

```bash
# sync latest remote artifact root locally, then write current_state_summary.json and token_budget_estimate.json
```

Done when:

- latest remote artifacts are locally mirrored or explicitly referenced,
- the production quality contradiction is classified,
- Wave 1 run contract exists with a token ceiling,
- Jake has a clear approve/hold decision for the next execution wave.

## 21. Plan maintenance

Update this plan when:

- the remote artifact root changes,
- the known queue item is closed,
- production-quality truth changes,
- fresh inventory produces new gaps,
- a token estimate differs materially from actuals,
- a phase completes,
- a blocker changes the route,
- agent count/execution placement changes,
- Jake makes a strategic decision.

Memory/update path:

```text
/root/clawd/memory/projects/mailchimp.md
```

Plan truth boundary:

This `plan.md` is a planning and coordination artifact. It is not implementation proof. Completion claims require the evidence and verifiers named above.
