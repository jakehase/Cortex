# Mailchimp Clone Decisions

Append-only durable decisions for Mailchimp clone/full-parity work. Keep current state in `STATUS.md`; keep strategy in `plan.md`.

## Decisions

## 2026-06-30 — Use canonical full-parity `plan.md`

- Decision: `/root/clawd/mailchimp-clone/plan.md` is the canonical Mailchimp full-parity plan.
- Reason: Mailchimp full clone/parity work needs explicit negative-space, verifier, and truth-boundary controls.
- Evidence: `/root/clawd/mailchimp-clone/plan.md`.
- Supersedes: older dated Mailchimp plan docs and artifact snapshot plans as active roadmap.
- Follow-up: Keep older docs/evidence accessible but non-canonical unless re-promoted.

## 2026-06-26 — Stop treating no-holdback run as resumable without audit

- Decision: Latest 100-agent no-holdback run should not be blindly resumed or patched after the wave24 pause/red state.
- Reason: Jake’s no-more-bandaids rule requires end-to-end audit after meaningful failures; current truth has usage-limit pause, objective-truth red, and production-quality concerns.
- Evidence: `/root/clawd/memory/projects/mailchimp.md`; remote root `/home/jake/clawd-remote/large-project-capability-stack/artifacts/benchmarks/mailchimp_100agent_real_parity_240m_noholdback/mailchimp-real-parity-100agent-noholdback-4h-real-launch-20260625T052039Z`.
- Supersedes: immediate targeted patch/resume as default next move.
- Follow-up: Audit orchestration architecture, runner/control-plane split, truth/supervisor path, remote baseline integrity, and artifact/reporting setup.

## 2026-07-04 — Adopt plan lifecycle files

- Decision: Mailchimp now has `STATUS.md` and `DECISIONS.md` companions for the canonical plan.
- Reason: Prevent old Mailchimp artifact plans, dated docs, and scoped benchmark summaries from being mistaken for current full-parity strategy.
- Evidence: `/root/clawd/mailchimp-clone/STATUS.md`; `/root/clawd/mailchimp-clone/DECISIONS.md`; `/root/clawd/docs/PLAN_INDEX.md`.
- Supersedes: using project memory alone as current status.
- Follow-up: Update `STATUS.md` before any future Mailchimp resume/new campaign.
