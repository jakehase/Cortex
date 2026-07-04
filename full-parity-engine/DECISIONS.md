# Full Parity Engine Decisions

Append-only durable decisions for the Full Parity Engine. Keep current state in `STATUS.md`; keep strategy in `plan.md`.

## Decisions

## 2026-07-04 — Create Full Parity Engine as separate canonical project

- Decision: Created `/root/clawd/full-parity-engine/plan.md` as the canonical plan for parity/negative-space/full-clone objective infrastructure.
- Reason: Full parity is a cross-project control-plane capability, not an AI OS-only milestone or Mailchimp-only benchmark patch.
- Evidence: commit `b815dcb0a`; `/root/clawd/docs/PLAN_INDEX.md`.
- Supersedes: scattering full-parity roadmap notes across AI OS, Mailchimp, and artifact plans.
- Follow-up: Implement FPE-0 matrix contract dry run before launching heavy agents.

## 2026-07-04 — Primary stop condition is matrix green or gap inventory

- Decision: FPE primary stop condition is `parity_matrix_green_or_gap_inventory`.
- Reason: Full parity must account for negative space and unknowns; finite graph exhaustion or benchmark threshold green is insufficient.
- Evidence: `/root/clawd/full-parity-engine/plan.md` sections 12-15.
- Supersedes: treating scoped implementation green or raw LOC as full-clone completion.
- Follow-up: Build schemas that make missing/unknown rows impossible to count as green.

## 2026-07-04 — No heavy FPE agent launch before FPE-0

- Decision: Heavy FPE runs are blocked until schemas/fixtures/no-write inventory dry run are green or blocked.
- Reason: The 6h AI OS run proves sustained orchestration, but FPE needs objective inventory and matrix truth before productive scale.
- Evidence: `/root/clawd/full-parity-engine/STATUS.md` next actions.
- Supersedes: launching agents from a vague full-parity roadmap.
- Follow-up: Implement `packages/full-parity-engine` schemas and tests first.

## 2026-07-04 — Adopt plan lifecycle files

- Decision: FPE uses `plan.md` for strategy, `STATUS.md` for current checkpoint, and `DECISIONS.md` for durable choices.
- Reason: Keep current state separate from strategy and prevent artifact plan confusion.
- Evidence: `/root/clawd/full-parity-engine/STATUS.md`; `/root/clawd/full-parity-engine/DECISIONS.md`; `scripts/plan-doctor.mjs`.
- Supersedes: using one long plan as roadmap + status + decision log.
- Follow-up: Keep `docs/PLAN_INDEX.md` updated when FPE status or milestone changes.
