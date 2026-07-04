# Full Parity Engine Plan

Template source: `/root/clawd/docs/PROJECT_PLAN_TEMPLATE.md`.

## Plan metadata

- Project slug: `full-parity-engine`
- Plan owner: `Jake + Cortex`
- Created: `2026-07-04`
- Last updated: `2026-07-04`
- Status: `active`
- Fidelity target: `platform` + `full_clone` enablement
- Primary stop condition: `parity_matrix_green_or_gap_inventory`
- Secondary stop condition: `supervisor_green_or_blocker_report`
- Status file: `/root/clawd/full-parity-engine/STATUS.md`
- Decisions log: `/root/clawd/full-parity-engine/DECISIONS.md`
- Plan index entry: `/root/clawd/docs/PLAN_INDEX.md`

## Planning lifecycle guard

- Keep this `plan.md` strategic: objective, architecture, phases, stop condition, and truth boundary.
- Keep current checkpoint/blockers/next actions in `/root/clawd/full-parity-engine/STATUS.md`.
- Keep durable choices and supersession notes in `/root/clawd/full-parity-engine/DECISIONS.md`.
- Do not treat artifact/recovery plans as active roadmaps unless this plan or `/root/clawd/docs/PLAN_INDEX.md` explicitly promotes them.

## 1. Working name

**Full Parity Engine** — a reusable control-plane/product-planning system that turns a broad product objective, clone target, or parity request into an expanding surface matrix, verifier matrix, implementation work graph, and truth-gated completion packet.

Stable slug: `full-parity-engine`.

## 2. Decision summary

Build the Full Parity Engine as a shared capability rooted in `/root/clawd/large-project-capability-stack`, with this plan as the canonical project contract at `/root/clawd/full-parity-engine/plan.md`. The first milestone is a deterministic parity inventory + negative-space scanner that can produce a machine-readable surface matrix and verifier matrix for AI OS, Mailchimp, and one brownfield repo without claiming implementation completion. This plan does **not** claim full product parity, runtime replacement, or universal autonomy until the relevant matrices are green and evidence-backed.

## 3. Core thesis / objective

Primary objective:

- Convert “build the whole thing,” “full clone,” “exact clone,” or “reach parity” requests into an objective-grounded, continuously expanding, truth-gated implementation system.

User/operator served:

- Jake, when asking Cortex/OpenClaw to pursue large product builds without losing scope truth.
- Agent orchestration workers, which need clear surfaces, ownership, verifiers, and stop conditions.
- Reviewers/supervisors, which need artifact-backed claims rather than vibe-based completion.

Desired outcome:

- A repeatable engine that can discover product surfaces, expose missing negative space, assign real work, verify outcomes, and continue until either the declared parity matrix is green or a blocker/gap inventory is explicit.

Why existing pieces are insufficient alone:

- The 6h AI OS run proves sustained real-work orchestration, but not full parity discovery.
- Current controllers can keep workers productive, but they still need a stronger objective model for “unknown missing surfaces.”
- Existing benchmark pass/fail truth gates are strong for declared contracts, but full parity requires reference inventory, negative-space accounting, verifier coverage, and claim-integrity proof.

Success changes:

- “Full clone” stops being a vague phrase and becomes a matrix with surfaces, evidence, gaps, verifiers, and continuation logic.
- Long-running agents can expand the work graph from the objective instead of exhausting a finite surface list and stopping too early.
- Product parity claims become auditable, replayable, and downgrade-safe.

## 4. Scope

In scope:

- Objective contract and fidelity binding (`prototype`, `production_slice`, `parity_for_scope`, `full_clone`).
- Reference/source-of-truth inventory for clone/parity targets.
- Target product inventory for implemented surfaces.
- Negative-space discovery: missing routes, workflows, models, states, permissions, integrations, UX views, persistence, API contracts, and operational behaviors.
- Parity matrix and verifier matrix generation.
- Work graph decomposition into agent-safe surfaces.
- File ownership, lease, and merge policy for large agent swarms.
- Continuous objective expansion when the current finite graph is exhausted but the objective remains red.
- Claim gate that separates mechanical green, threshold pass, product parity, and full clone status.
- Cross-repo adapters for at least AI OS, Mailchimp, and one non-Mailchimp brownfield project.
- Artifact replay contract: inventory, matrix, work graph, run contract, verifier results, claim packet, blocker report.

## 5. Non-goals

Out of scope for the first milestone:

- Claiming any product is a full clone without a green parity matrix.
- Browser-perfect visual parity without a declared visual oracle and screenshot verifier.
- External writes, deployments, emails, purchases, or public actions.
- Replacing Cortex/OpenClaw routing or the chat/control-plane brain.
- Treating docs/tests/benchmark harness changes as product parity implementation.
- Hiding gaps behind high raw LOC, large diffs, or mechanically green runs.

Eventual ambition:

- A parity-first autonomous product builder that can handle full product clones and complex platform builds with durable truth gates.

Current milestone:

- Build the inventory/matrix/negative-space contract and prove it with dry-run matrices before launching another high-scale implementation campaign.

## 6. Active path / repo layout

Canonical plan:

```text
/root/clawd/full-parity-engine/plan.md
```

Active implementation paths:

```text
/root/clawd/large-project-capability-stack/packages/full-parity-engine/       # planned shared library
/root/clawd/large-project-capability-stack/apps/system-benchmark/             # planned runner/benchmark integration
/root/clawd/ai-os/                                                            # first product consumer / AI OS language integration
/root/clawd/mailchimp-clone/                                                  # clone/parity proving ground
/root/clawd/pmhnp-denial-copilot/                                             # brownfield transfer proving ground
```

Important existing assets:

```text
/root/clawd/docs/PROJECT_PLANNING.md                                          # planning standard
/root/clawd/docs/PROJECT_PLAN_TEMPLATE.md                                     # plan template
/root/clawd/large-project-capability-stack/packages/continuous-workload-controller/
/root/clawd/large-project-capability-stack/packages/multi-agent-orchestrator/
/root/clawd/large-project-capability-stack/packages/claim-integrity/
/root/clawd/large-project-capability-stack/apps/system-benchmark/run-continuous-real-workload-controller.mjs
/root/clawd/public/cortex_server                                              # structural/code memory and prior-art context
```

Quarantined or superseded paths:

```text
/root/clawd/artifacts/**/repo*/                                               # evidence snapshots only; not active source
/root/clawd/_quarantine/**                                                    # historical/recovery only
/root/clawd/_rerun_*                                                          # historical rerun scratch only
```

Path rules:

- Product implementation happens in active repos, not artifact snapshots.
- Artifact snapshots can be used as evidence and replay inputs, but never as canonical source by accident.
- If a new active implementation path is selected, update this plan and `/root/clawd/docs/PLAN_INDEX.md`.

## 7. Prior art and existing assets

Prior-art gate decision: `extend_existing`.

Existing assets to reuse/extend:

- Continuous real-workload controller for long-running waves.
- Multi-agent orchestrator for patch queues, worker isolation, and merge arbitration.
- Claim-integrity package for truth-layer separation.
- Objective expansion primitives already used in Mailchimp strict-ceiling repair work.
- Cortex structural memory for source inventory and code graph queries.
- AI OS language/kernel surfaces for future self-hosted parity job descriptions.

Known overlaps or duplication risks:

- Rebuilding another orchestration controller instead of extending the current one.
- Treating benchmark-only verifier logic as product-control-plane truth.
- Confusing clone parity with declared benchmark threshold pass.

Decision:

- Full Parity Engine is a shared objective/truth layer above existing controllers, not a replacement runner.

## 8. Target architecture

Architecture summary:

The engine takes an objective, reference target, active product path, fidelity level, and verifier budget. It builds a reference inventory and target inventory, computes a parity matrix with observed/estimated/missing surfaces, expands missing work into owned shards, launches/monitors implementation waves through the existing controller, then recomputes truth after each wave until the matrix is green or a blocker/gap inventory is explicit.

Subsystems:

- **Objective Contract Binder** — binds user request to anchor, path, fidelity, scope, implementation surface, stop condition, and claim boundary.
- **Reference Inventory Adapter** — extracts source-of-truth surfaces from reference repos/apps/specs/screenshots/API docs.
- **Target Inventory Adapter** — inventories the current implementation and maps files/routes/models/tests to surfaces.
- **Negative-Space Scanner** — finds missing or under-modeled workflows, UI states, APIs, persistence, permissions, integrations, and edge cases.
- **Parity Matrix Builder** — writes observed/estimated/confidence/missing rows with verifier requirements.
- **Verifier Matrix Builder** — maps surfaces to deterministic tests, browser checks, schema checks, static checks, and manual-review packets.
- **Work Graph Decomposer** — turns missing matrix rows into implementation shards with file ownership and lease policy.
- **Continuous Expansion Supervisor** — decides whether to launch another wave, expand the graph, stop green, or write a blocker.
- **Claim Gate** — emits allowed claims and explicitly rejects over-scoped claims.
- **Promotion/Sync Gate** — requires post-run tests, source sync, commit, push, and remote verification before calling work durable.

Key boundaries:

- Control plane: OpenClaw/Cortex on `/root/clawd` for planning, supervision, artifact consumption, and user reporting.
- Execution plane: Hetzner `37.27.129.239` for heavy agent runs and browser-heavy verification.
- Evidence boundary: artifact truth beats chat memory and progress summaries.
- External-action boundary: no user-visible external writes without explicit approval.
- Claim boundary: threshold-green is not product parity; product parity is not full clone unless the full clone matrix is green.

Interface contracts:

```text
objective_contract.json        # anchor, target path, fidelity, scope, stop condition
reference_inventory.json       # source-of-truth surfaces
implementation_inventory.json  # observed target surfaces
negative_space_inventory.json  # missing/uncertain surfaces
parity_matrix.json             # per-surface status, confidence, verifier, claim allowed
verifier_matrix.json           # deterministic/browser/manual verifiers by surface
work_graph.json                # implementation shards, ownership, leases
supervisor_truth.json          # green/red/blocker truth with claim layer separation
claim_packet.json              # exact allowed user-visible claims
```

Architecture decisions:

| Decision | Options considered | Chosen option | Reason | Revisit when |
|---|---|---|---|---|
| Engine placement | AI OS only / benchmark only / shared stack | Shared stack with AI OS consumer | Full parity is cross-project control-plane capability | AI OS becomes self-hosted runtime |
| Stop condition | tests pass / finite graph exhausted / matrix green or gap inventory | `parity_matrix_green_or_gap_inventory` | Full parity needs negative-space truth | Matrix schema proves too weak |
| Scale path | jump to 100 unique workers / staged scale | staged 12 physical → 25 → 45 → 100 | Provider and merge truth need proof at each level | Provider ledger supports higher safe concurrency |
| Reference truth | prompt-only / repo-only / multi-source | multi-source with confidence | Clones need UI/API/workflow/persistence truth | Reference source unavailable |

## 9. Surface matrix / subsystem ownership

| Surface / subsystem | Owner / agent squad | Primary files | Allowed write scope | Verifiers | Claim allowed when |
|---|---|---|---|---|---|
| Objective contract binder | planner/control-plane | `packages/full-parity-engine/*objective*` | shared stack only | schema + fixture tests | request is fully grounded |
| Reference inventory | inventory squad | `packages/full-parity-engine/*inventory*` | inventory adapters | fixture repo inventory tests | reference surfaces reproducible |
| Negative-space scanner | gap squad | `packages/full-parity-engine/*negative*` | scanner + fixtures | missing-surface golden tests | gaps are explicit/confidence-rated |
| Parity matrix | truth squad | `packages/full-parity-engine/*matrix*` | matrix/schema/claim code | matrix schema + downgrade tests | each row has status/evidence/verifier |
| Work graph decomposer | orchestration squad | `packages/full-parity-engine/*work-graph*` + controller adapter | work graph + adapter only | no-overlap/lease tests | shards have owners and verifiers |
| Continuous expansion | supervisor squad | existing continuous controller + FPE adapter | controller adapter + tests | finite-graph exhaustion tests | objective red expands or blocks honestly |
| Promotion/sync gate | release squad | promotion scripts + claim packet | sync/commit/push gate | local + remote verification | durable source equals green artifacts |

Ownership rules:

- Agents may only edit owned files unless the work graph grants a lease.
- Shared verifier/schema files require explicit claim-gate tests.
- Docs/tests/harness-only changes do not count as parity implementation unless the surface is explicitly a verifier/documentation surface.

## 10. Agent strategy

Agent count target:

- Wave 0: deterministic local implementation, no heavy agents.
- Wave 1: 10-12 physical workers on one repo dry-run fixtures.
- Wave 2: 25 physical workers across two dissimilar repos.
- Wave 3: 45 physical workers with 100 logical objective scale.
- Wave 4: 100 physical workers only after provider ledger, token budget, merge arbitration, and objective expansion gates are green.

Execution placement:

- Control plane: `/root/clawd` on OpenClaw host.
- Execution plane: `jake@37.27.129.239:/home/jake/clawd-remote`.
- Remote boundary required? `yes` for heavy runs.
- Heavy execution allowed locally? `no`, unless Jake explicitly grants a local exception.

Agent roles:

- planner: bind objective and produce contract.
- inventory: build reference/target inventories.
- gap analyst: produce negative-space rows.
- implementer: modify product surfaces only.
- verifier: run matrix verifiers and write evidence.
- reviewer: audit claim packets and downgrade overclaims.
- release/audit: sync, test, commit, push, and verify remote durability.

Launch gates before many agents:

- [ ] objective contract exists
- [ ] reference inventory exists or blocker states why not
- [ ] target inventory exists
- [ ] parity matrix exists
- [ ] verifier matrix exists
- [ ] file ownership/lease strategy exists
- [ ] artifact return contract exists
- [ ] blocker format exists
- [ ] execution plane is verified
- [ ] provider/model ledger can prove real worker activity

## 11. Phases / waves

### Wave 0 — Matrix contract and fixtures

Goal:

- Implement schemas and fixture tests for objective contracts, inventories, negative-space inventories, parity matrices, verifier matrices, work graphs, supervisor truth, and claim packets.

Inputs:

- This plan.
- Existing claim-integrity and continuous-controller code.
- At least three fixture targets: tiny synthetic app, AI OS, Mailchimp slice.

Outputs:

- JSON schemas.
- Golden fixture matrices.
- No-agent dry-run CLI.

Verifiers:

```bash
cd /root/clawd/large-project-capability-stack && node --test tests/full-parity-engine*.test.mjs
```

Stop condition:

```text
matrix_contract_green_or_schema_blocker
```

### Wave 1 — Inventory and negative-space dry runs

Goal:

- Generate artifact-backed inventories and gap reports for AI OS, Mailchimp, and one brownfield repo without implementation writes.

Outputs:

- `reference_inventory.json`
- `implementation_inventory.json`
- `negative_space_inventory.json`
- `parity_matrix.json`
- `verifier_matrix.json`

Stop condition:

```text
three_repo_inventory_green_or_gap_inventory_blocker
```

### Wave 2 — Work graph and supervisor expansion

Goal:

- Convert missing matrix rows into implementation shards and prove the supervisor expands when the graph is exhausted but objective truth remains red.

Stop condition:

```text
objective_red_expands_or_blocks_honestly
```

### Wave 3 — Production-slice implementation campaign

Goal:

- Run a bounded production-slice campaign against AI OS or Mailchimp using FPE-generated work graphs.

Stop condition:

```text
parity_for_scope_matrix_green_or_blocker_report
```

### Wave 4 — Full-clone/parity campaign

Goal:

- Run a declared full-clone/full-parity campaign only after inventory and verifier coverage are strong enough.

Stop condition:

```text
full_clone_parity_matrix_green_or_gap_inventory
```

## 12. Verifier and evidence contract

Required artifacts for every run:

```text
objective_contract.json
reference_inventory.json
implementation_inventory.json
negative_space_inventory.json
parity_matrix.json
verifier_matrix.json
work_graph.json
run_contract.json
provider_ledger.json
supervisor_truth.json
claim_packet.json
blocker_report.json  # if red/blocked
promotion_report.json # if green/synced
```

Verifier layers:

- Schema validity.
- Static inventory reproducibility.
- Negative-space confidence checks.
- Verifier matrix coverage thresholds.
- Product tests/browser/API checks for implemented surfaces.
- Claim-gate downgrade tests.
- Provider/worker/token ledger proof for real model work.
- Sync/commit/push verification for durable source state.

Claim rules:

- `thresholdPass=true` allows only the declared benchmark claim.
- `parity_for_scope` requires every in-scope row green or explicitly waived by scope.
- `full_clone` requires full reference inventory coverage, negative-space closure, verifier matrix green, and no unblocked red/unknown critical rows.

## 13. Artifacts and replay commands

Artifact roots:

```text
/root/clawd/artifacts/full-parity-engine/
/home/jake/clawd-remote/full-parity-engine/artifacts/
```

Planned commands:

```bash
node apps/system-benchmark/build-full-parity-inventory.mjs <objective_contract.json>
node apps/system-benchmark/build-full-parity-work-graph.mjs <parity_matrix.json>
node apps/system-benchmark/run-full-parity-controller.mjs <run_contract.json>
node apps/system-benchmark/evaluate-full-parity-claim.mjs <artifact_root>
```

Until these exist, any invocation is a plan item, not an implemented capability.

## 14. Stop condition

Primary stop condition:

```text
parity_matrix_green_or_gap_inventory
```

Meaning:

- Green only when the declared matrix scope is green with evidence.
- Red/blocked when critical rows remain missing, unknown, unverifiable, or contradiction-bearing.
- If the current finite work graph is exhausted while the objective remains red, the supervisor must expand from the objective or write a blocker; it must not call completion.

## 15. Truth boundary

Allowed current claim:

- The 6h AI OS run proves sustained real-work orchestration and green post-run validation for that declared continuation/hardening benchmark.

Not yet allowed:

- Full parity engine implemented.
- Runtime replacement.
- Full product clone/parity.
- Universal autonomy across arbitrary repos.
- 100 unique physical model workers sustained concurrently.

Future full parity claim requires:

- Reference inventory.
- Target inventory.
- Negative-space inventory.
- Parity matrix.
- Verifier matrix.
- Implementation evidence.
- Provider/worker proof.
- Claim packet.
- Post-run sync/commit/push verification.

## 16. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Agents optimize for easy rows and ignore missing surfaces | Negative-space scanner and matrix red rows drive next work graph |
| Green benchmark overclaimed as full parity | Claim packet separates threshold, parity-for-scope, and full clone |
| Artifact snapshots become mistaken as active source | Plan index and active path rules point only to canonical repos |
| Large generated diffs hide low-value code | Unique-line, top-file concentration, product-verifier, and semantic review gates |
| Provider limits interrupt long runs | Usage-limit backoff/resume with no duplicate replay |
| Full reference source unavailable | Emit gap inventory/blocker instead of guessing |

## 17. Immediate next milestone

**Milestone FPE-0: matrix contract dry run.**

Concrete next work:

1. Create `packages/full-parity-engine` with schema/types for objective contract, inventories, parity matrix, verifier matrix, work graph, supervisor truth, and claim packet.
2. Add fixture tests proving unknown/missing rows cannot be counted as green.
3. Build a no-write inventory dry-run for AI OS and Mailchimp slice.
4. Produce first artifact root under `/root/clawd/artifacts/full-parity-engine/fpe-0-*`.
5. Stop with either `matrix_contract_green` or a blocker report.

No heavy agent launch should happen for this project until FPE-0 is green.
