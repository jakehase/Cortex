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
