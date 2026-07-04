# Project Planning Standard

This is the workspace-wide standard for serious project plans.

Use it when starting, restarting, expanding, or handing off any project large enough that scope, architecture, agents, evidence, or completion truth could become ambiguous.

The AI OS plan at `/root/clawd/ai-os/plan.md` is the first major example of this pattern, not a one-off exception.

The canonical template at `/root/clawd/docs/PROJECT_PLAN_TEMPLATE.md` was selected through a 20-candidate template tournament archived at `/root/clawd/docs/project-plan-template-tournament/20260630T212253Z/`. Use that archive when reviewing or improving the planning standard.

## Core rule

Every serious project should have a `plan.md` at the active project root.

Examples:

```text
/root/clawd/ai-os/plan.md
/root/clawd/<project>/plan.md
/root/clawd/<repo>/plan.md
```

If the project already has a canonical repo, put the plan in that repo. If the project spans multiple repos or is still conceptual, create a project directory under `/root/clawd/<project>/` and put `plan.md` there.

## Planning lifecycle files

For serious active projects, `plan.md` is only one file in a small lifecycle set:

```text
plan.md        # stable strategy/contract: objective, scope, architecture, stop condition, truth boundary
STATUS.md      # current checkpoint: latest verified state, blockers, next 1-3 actions
DECISIONS.md   # append-only durable decisions: what changed, why, evidence, supersession
```

Keep the roles separate:

| File | Purpose | Update cadence | Should not contain |
|---|---|---|---|
| `plan.md` | Operating contract and strategy | When scope, architecture, phases, stop condition, or truth boundary changes | running diary, every checkpoint, raw logs |
| `STATUS.md` | Current state and next actions | After green runs, blockers, commits, pushes, resumes, or handoffs | long roadmap, historical decision debate |
| `DECISIONS.md` | Durable decision log | When a choice supersedes or constrains future work | volatile counts, noisy progress logs |
| `docs/PLAN_INDEX.md` | Workspace map of active plans | When active path/status/latest milestone changes | artifact dumps or private secrets |

Use the templates:

```text
/root/clawd/docs/PROJECT_PLAN_TEMPLATE.md
/root/clawd/docs/PROJECT_STATUS_TEMPLATE.md
/root/clawd/docs/PROJECT_DECISIONS_TEMPLATE.md
```

The core organizing principle is: **strategy stays stable, status stays current, decisions stay append-only**.

## When a `plan.md` is required

Create or update a plan when the work involves any of these:

- multi-phase implementation,
- agent orchestration,
- 10+ agent or remote execution work,
- product architecture or platform design,
- clone/parity claims,
- external integrations,
- durable project decisions,
- significant refactors,
- safety/security/permission boundaries,
- long-running campaigns,
- handoff between sessions or agents,
- any request phrased like “build the whole thing,” “full clone,” “exact clone,” “operating system,” “platform,” “roadmap,” or “use 100 agents.”

A tiny one-file fix does not need a full plan unless the user asks for one.

## Purpose of `plan.md`

A plan is not a motivational essay. It is an operating contract.

It should answer:

1. What are we building?
2. Why does it matter?
3. What is in scope?
4. What is explicitly out of scope?
5. Where is the active implementation path?
6. What are the architecture boundaries?
7. Which phases/waves exist?
8. Which agents/subsystems own which surfaces?
9. What verifiers prove each phase?
10. What artifacts/evidence must exist?
11. What condition allows us to say “done”?
12. What truth boundary prevents overclaiming?

## Required sections

A serious `plan.md` should include these sections, in this order unless there is a good reason not to:

1. **Working name**
2. **Core thesis / objective**
3. **Scope**
4. **Non-goals**
5. **Active path / repo layout**
6. **Prior art and existing assets**
7. **Target architecture**
8. **Subsystem ownership matrix**
9. **Agent strategy**
10. **Phases / waves**
11. **Verifier and evidence contract**
12. **Artifacts and replay commands**
13. **Stop condition**
14. **Truth boundary**
15. **Risks and mitigations**
16. **Immediate next milestone**

## Planning truth rules

- Do not let a plan imply implementation exists.
- Do not call docs, tests, harnesses, or benchmark scaffolding “feature implementation.”
- Separate product ambition from current milestone.
- Separate hosted, remote, bootable, native, public, private, prototype, production, parity, and full-clone truth layers.
- If the plan is for a full clone or full OS, include negative space: what is missing and how it will be discovered.
- If agents are involved, include ownership boundaries and merge/verifier gates before launch.
- If external systems are involved, include approval boundaries.
- If a plan changes materially, update the file instead of relying on chat memory.

## Agent orchestration rule

For multi-agent work, the plan must include:

- agent count target,
- execution plane,
- surface matrix,
- file ownership/lease strategy,
- verifier map,
- artifact return contract,
- supervisor stop condition,
- blocker format,
- claim-gate criteria.

Do not launch 100 agents from a vague plan. Use staged waves:

1. spec/contracts wave,
2. prototype wave,
3. integration wave,
4. high-scale build wave,
5. release/evidence wave.

## Prior-art gate

Before a project introduces new product/control-plane primitives, run the Cortex prior-art gate when available and record the decision in the plan:

- `reuse_existing`
- `extend_existing`
- `adapter_wrapper_only`
- `new_primitive_justified`

The plan should name what existing systems are being reused or extended.

## Stop condition patterns

Good stop conditions:

- `supervisor_green_or_blocker_report`
- `release_candidate_packet_green_or_blocker`
- `all_phase_verifiers_green_or_blocker`
- `parity_matrix_green_or_gap_inventory`
- `boot_proof_green_or_blocker`

Bad stop conditions:

- “when it feels complete”
- “when enough code exists”
- “when tests pass” without saying which tests and what claim they prove
- “when agents finish”

## Artifact expectations

Plans should point to canonical artifacts, not only chat summaries.

Common artifact types:

- surface matrix,
- work graph,
- run contract,
- dependency manifest,
- verifier catalog,
- execution summary,
- claim gate,
- blocker report,
- release packet,
- artifact bundle manifest,
- replay commands.

## Updating project lifecycle files

Update `plan.md` when:

- scope changes,
- architecture changes,
- phase definitions or wave strategy change,
- stop condition changes,
- truth boundary changes,
- a new active path is chosen,
- a previously planned path is quarantined,
- the user makes a strategic decision that changes the operating contract.

Update `STATUS.md` when:

- a run finishes green/red/blocked,
- a resume or monitor changes current state,
- a commit/push/source-sync changes durable state,
- a blocker becomes active or is cleared,
- the next 1-3 actions change,
- handing off to a future session.

Update `DECISIONS.md` when:

- a path is selected or superseded,
- a plan changes direction,
- a promotion/demotion boundary is established,
- a tool/runtime/auth/execution boundary decision is made,
- a prior assumption is corrected.

Update `docs/PLAN_INDEX.md` when:

- a project is created, archived, superseded, blocked, or completed,
- active implementation path changes,
- latest verified commit/artifact changes materially,
- a new canonical plan appears.

For major updates, also update the relevant `memory/projects/<project>.md` summary.

## Plan doctor

Use the plan doctor before/after planning changes:

```bash
cd /root/clawd && node scripts/plan-doctor.mjs
```

The doctor checks that active canonical plans are indexed, companion `STATUS.md` and `DECISIONS.md` files exist, active plans have stop conditions and current milestones, and unindexed plan-like files are either historical/evidence-only or explicitly indexed. Use `--strict` to fail on warnings, `--verbose` to list classified historical/evidence plans, and `--include-evidence` for a slower audit that samples artifact/recovery plan-like files too.

## Copyable template

Use `/root/clawd/docs/PROJECT_PLAN_TEMPLATE.md` when creating a new project plan.

## Template improvement process

When the global template needs a major revision, prefer a small template tournament instead of editing by vibes:

1. Keep the current canonical template unchanged during the tournament.
2. Generate candidate templates under `docs/project-plan-template-tournament/<timestamp>/`.
3. Score candidates with a rubric covering universality, truth discipline, agent readiness, verifier/evidence strength, architecture clarity, safety, copyability, and artifact/replay contracts.
4. Synthesize the winner into `winner-synthesis.md`.
5. Replace `PROJECT_PLAN_TEMPLATE.md` only after the synthesis is written and the tournament archive is saved.
6. Record the change in daily memory.
