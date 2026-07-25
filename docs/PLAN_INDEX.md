# Workspace Plan Index

Last updated: 2026-07-11

Purpose: make the active plans obvious and keep historical/artifact plans from becoming accidental roadmaps.

## File roles

| File | Role |
|---|---|
| `plan.md` | Stable project strategy and operating contract |
| `STATUS.md` | Current checkpoint, blockers, latest verification, next actions |
| `DECISIONS.md` | Append-only durable decision/supersession log |
| `docs/PLAN_INDEX.md` | Workspace-wide map of active/superseded plans |

## Active canonical plans

| Project | Status | Canonical plan | Status file | Decisions log | Active path | Latest verified commit/artifact | Current milestone | Notes |
|---|---|---|---|---|---|---|---|---|
| AI OS | active | `/root/clawd/ai-os/plan.md` | `/root/clawd/ai-os/STATUS.md` | `/root/clawd/ai-os/DECISIONS.md` | `/root/clawd/ai-os` | commit `13aa9a3ef` source sync; commit `b815dcb0a` plan/FPE map; 6h promotion `/root/clawd/artifacts/ai-os/orchestration/latest-6h-continuation-green.json` | hosted/platform hardening after 6h continuation; next runtime claims still gated | Default-on adapter remains bounded internal substrate, not runtime replacement. |
| Full Parity Engine | active | `/root/clawd/full-parity-engine/plan.md` | `/root/clawd/full-parity-engine/STATUS.md` | `/root/clawd/full-parity-engine/DECISIONS.md` | `/root/clawd/full-parity-engine` + shared stack adapters | commit `b815dcb0a` initial plan | FPE-0 matrix contract dry run | Cross-repo parity/clone objective engine. Planned, not implemented. |
| Mailchimp clone | active | `/root/clawd/mailchimp-clone/plan.md` | `/root/clawd/mailchimp-clone/STATUS.md` | `/root/clawd/mailchimp-clone/DECISIONS.md` | `/root/clawd/mailchimp-clone` | latest no-holdback artifact root in `STATUS.md`; see `memory/projects/mailchimp.md` for detailed history | audit before resume / fresh FPE parity matrix | Product clone/parity proving ground. Treat older Mailchimp docs as historical unless referenced by canonical plan or project memory. |
| Agent Work v1 orchestration | maintenance | `/root/clawd/large-project-capability-stack/plan.md` | `/root/clawd/large-project-capability-stack/STATUS.md` | `/root/clawd/large-project-capability-stack/DECISIONS.md` | `/root/clawd/large-project-capability-stack` | commit `4a2cc317e`; semantic-workforce suite `17/17` and full local suite `433/433` on `2026-07-11` | v1.1 semantic-workforce amendment locally green; v1.0.0 remains release tag | Automatic bounded per-wave sizing is canonical; selected count is not physical-concurrency proof. Public GA, deployment, universal parity, and higher physical-worker claims remain out of scope. |
| Cortex Learning OS | active | `/root/clawd/cortex-learning-os/plan.md` | `/root/clawd/cortex-learning-os/STATUS.md` | `/root/clawd/cortex-learning-os/DECISIONS.md` | `/root/clawd/cortex-learning-os` | implementation commit `b03add355`; qualified run `artifacts/math-foundations-smoke-20260725-052939567Z`; tests `14/14` | equal-difficulty randomized A/B transfer retests | First bounded learning loop is green for one exact-arithmetic lesson. Broad/durable learning and retrieval causality remain unproven. |

## Evidence-only plan-like files

These may contain useful audit/recovery details, but they are **not** active roadmaps:

- `/root/clawd/ai-os/artifacts/**/reports/*plan*.md`
- `/root/clawd/artifacts/**`
- `/root/clawd/large-project-capability-stack/artifacts/**`
- any `repo/`, `repo_baseline/`, `repo_preflight/`, or `returned_artifacts/workspace/` snapshot under benchmark artifacts

## Historical / superseded areas

Do not use these as active implementation paths unless explicitly re-promoted in a current `plan.md`:

- `/root/clawd/_quarantine/**`
- `/root/clawd/_backups/**`
- `/root/clawd/_rerun_*`
- `/root/clawd/.cortex-export/**`
- stale dated `docs/*PLAN*.md` files not referenced by an active canonical plan

## Plan-doctor gate

Run the planning validator after plan lifecycle edits:

```bash
cd /root/clawd && node scripts/plan-doctor.mjs
```

Use verbose mode to list classified historical/evidence plans:

```bash
cd /root/clawd && node scripts/plan-doctor.mjs --verbose
```

Use the slower evidence scan when investigating confusing artifact plans:

```bash
cd /root/clawd && node scripts/plan-doctor.mjs --include-evidence
```

## Rules for future planning

- A serious active project gets one canonical `plan.md` plus companion `STATUS.md` and `DECISIONS.md`.
- If a plan spans multiple repos, create `/root/clawd/<project-slug>/plan.md` and list implementation paths there.
- Artifact plans are evidence. Canonical plans are instructions.
- Keep `plan.md` strategic; update `STATUS.md` for current checkpoint; append `DECISIONS.md` for durable choices.
- If a project changes direction, update the canonical `plan.md`, `STATUS.md`, `DECISIONS.md` when needed, and this index in the same commit.
- If a path is superseded, quarantine or label it; do not leave ambiguous scratch plans in active paths.
