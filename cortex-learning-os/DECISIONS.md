# Cortex Learning OS Decisions

Append-only durable decisions for the project. Keep current state in `STATUS.md`; keep strategy in `plan.md`.

## Decision entry format

```markdown
## YYYY-MM-DD — <short decision title>

- Decision: <what changed>
- Reason: <why>
- Evidence: <commit/artifact/check>
- Supersedes: <older path/decision or n/a>
- Follow-up: <next action or n/a>
```

## Decisions

## 2026-07-07 — Create Cortex Learning OS as a verifier-gated learning layer

- Decision: Create `/root/clawd/cortex-learning-os` as the canonical project path for a learning layer built from capsules, curricula, practice attempts, verifiers, mistake ledgers, lesson promotion gates, and retrieval packs.
- Reason: Jake asked to turn the memory-system learning idea into a plan; the system should learn through exams and verified lessons, not raw memory volume or model-weight changes.
- Evidence: `/root/clawd/cortex-learning-os/plan.md`; `/root/clawd/docs/PLAN_INDEX.md`; `cd /root/clawd && node scripts/plan-doctor.mjs` returned `ok` with `0` errors, `5` indexed plans, and `17` pre-existing backup/DR plan-like warnings.
- Supersedes: Chat-only brainstorming about “Cortex Learning OS.”
- Follow-up: Start Wave 1 schema design.

## 2026-07-07 — Expand CLOS plan into execution checklist and estimates

- Decision: Keep initial implementation code local to `/root/clawd/cortex-learning-os`, and expand the plan with detailed stages A-I, token/time estimates, token budget rules, confusion-prevention rules, and pre-code decisions.
- Reason: Jake asked to make the plan thorough, organized, and detailed enough to prevent confusion, including estimates for token usage and time.
- Evidence: `/root/clawd/cortex-learning-os/plan.md` sections 18-21; `cd /root/clawd && node scripts/plan-doctor.mjs` returned `ok` with `0` errors, `5` indexed plans, and `17` pre-existing backup/DR plan-like warnings.
- Supersedes: The earlier high-level wave list as the only implementation guide.
- Follow-up: Start Stage A local scaffold when implementation is requested.

## 2026-07-07 — Confirm Cortex Learning OS plan already follows detailed planning standard

- Decision: Keep Cortex Learning OS as the reference example for the new detailed planning style, with only the estimate section title normalized to the shared template wording.
- Reason: It already contains detailed stages, acceptance checks, estimates, confusion-prevention rules, and open decisions before code starts.
- Evidence: `/root/clawd/cortex-learning-os/plan.md` sections 18-21.
- Supersedes: n/a.
- Follow-up: Use Stage A local scaffold when implementation begins.

## 2026-07-07 — Complete Stage A local scaffold

- Decision: Add a dependency-light local scaffold for Cortex Learning OS under `/root/clawd/cortex-learning-os`.
- Reason: Jake asked to execute low-token setup items first; Stage A is useful scaffolding without the heavier schema/capsule authoring work.
- Evidence: `package.json`, `src/paths.mjs`, `src/json.mjs`, `src/hash.mjs`, `src/validate-fixtures.mjs`, `tests/scaffold.test.mjs`.
- Supersedes: Planning-only state for Stage A.
- Follow-up: Stage B schema design remains next and is intentionally deferred until requested because it is more token-intensive.

## 2026-07-25 — Restart on an isolated branch and preserve the dormant prototype

- Decision: Base the restart on `origin/main` in worktree `/root/clawd/worktrees/cortex-learning-os-v0-20260725`, branch `feat/cortex-learning-os-v0-20260725`, and preserve the prior local prototype as commit `cb7b93007` before extending it.
- Reason: The original `/root/clawd/cortex-learning-os` directory was untracked inside a dirty, diverged memory-repair branch. Isolating the work prevented unrelated workspace changes from contaminating CLOS history.
- Evidence: commit `cb7b93007`; the preserved package passed its original `9/9` tests and fixture validation before extension.
- Supersedes: untracked-only local prototype state.
- Follow-up: merge/push the production slice through the authoritative remote default branch after final validation.

## 2026-07-25 — Quarantine a false-negative derangement verifier run

- Decision: Reject and quarantine run `math-foundations-smoke-20260725-052532795Z`; add regression checks for `D_6=265`, `D_8=14833`, `D_9=133496`, and `D_10=1334961`.
- Reason: The generated deterministic oracle incorrectly expected `0`, while Cortex's baseline and correction answers were correct. Promoting that “mistake” would teach a false lesson.
- Evidence: `artifacts/_quarantine/false-derangement-oracle-20260725-052532795Z/QUARANTINE.md`; `tests/math-foundations.test.mjs`.
- Supersedes: the run's original `blocked_correction_failed` interpretation.
- Follow-up: keep verifier regression fixtures as first-class evidence and never use the quarantined run for capability claims.

## 2026-07-25 — Complete and promote the first bounded learning loop

- Decision: Accept the exact-arithmetic stress run as the first qualified CLOS learning-loop proof and write its trusted lesson, retrieval pack, capability report, and qualified-run pointer to the canonical math-foundations capsule paths.
- Reason: The recorded model run produced a real deterministic baseline failure, passed a correction and independent promotion retest, satisfied all 10 promotion gates, and passed a different held-out item after loading the promoted retrieval pack.
- Evidence: implementation commit `b03add355`; `artifacts/math-foundations-smoke-20260725-052939567Z`; `artifacts/latest-qualified-run.json`; manifest replay `36/36`; local tests `14/14`.
- Supersedes: planning/scaffold-only CLOS status.
- Follow-up: run equal-difficulty randomized A/B retests before claiming retrieval causality or durable transfer.

## 2026-07-25 — Promote the qualified slice to the authoritative remote default branch

- Decision: Push `feat/cortex-learning-os-v0-20260725`, then fast-forward remote `main` after confirming `origin/main` remained an ancestor and the diff touched only `cortex-learning-os/` plus `docs/PLAN_INDEX.md`.
- Reason: The accepted production slice must live on the canonical default path and authoritative remote, not remain an opt-in local worktree.
- Evidence: `git ls-remote` showed both `main` and the feature branch at `944808d729183a1ec1ed0c6c114a6f0e024d35dc` immediately after promotion; `/root/clawd/cortex-learning-os` then matched the integrated project tree across all 139 files.
- Supersedes: feature-branch-only availability.
- Follow-up: preserve bounded claims and proceed to randomized equal-difficulty A/B transfer testing.
