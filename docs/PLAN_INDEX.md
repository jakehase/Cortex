# Workspace Plan Index

Last updated: 2026-07-04

Purpose: make the active plans obvious and keep historical/artifact plans from becoming accidental roadmaps.

## Active canonical plans

| Project | Canonical plan | Active path | Notes |
|---|---|---|---|
| AI OS | `/root/clawd/ai-os/plan.md` | `/root/clawd/ai-os` | AI OS product/platform plan. Default-on adapter remains bounded internal substrate, not runtime replacement. |
| Full Parity Engine | `/root/clawd/full-parity-engine/plan.md` | shared stack + product adapters | Cross-repo parity/clone objective engine. Current milestone is matrix/inventory contract, not implementation completion. |
| Mailchimp clone | `/root/clawd/mailchimp-clone/plan.md` | `/root/clawd/mailchimp-clone` | Product clone/parity proving ground. Treat older Mailchimp docs as historical unless referenced by this plan or project memory. |

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

## Rules for future planning

- A serious active project gets one canonical `plan.md` at its active root or a dedicated project directory.
- If a plan spans multiple repos, create `/root/clawd/<project-slug>/plan.md` and list implementation paths there.
- Artifact plans are evidence. Canonical plans are instructions.
- If a project changes direction, update the canonical `plan.md` and this index in the same commit.
- If a path is superseded, quarantine or label it; do not leave ambiguous scratch plans in active paths.
