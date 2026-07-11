# AI OS Status

## Metadata

- Project slug: `ai-os`
- Canonical plan: `/root/clawd/ai-os/plan.md`
- Decisions log: `/root/clawd/ai-os/DECISIONS.md`
- Last updated: `2026-07-11`
- Status: `active`
- Current fidelity: `platform` / hosted AI OS production slices

## Current checkpoint

- Current state: canonical AIOS v1 `.aios` compile→execute plus capability-gated provider read/compute is implemented; v1 is mechanically frozen and three recurring provider-backed workflows are dogfooded through the canonical adapter path.
- Canonical identifiers: language `aios.language.v1`; grammar `job-block-v1`; compiler `aios.language.compiler.canonical.v1`; adapter `openclaw-aios-adapter.v0.6-v1-freeze-provider-workflows`; provider policy `aios.provider-read-compute-policy.v1`; freeze policy `aios.language.freeze-policy.v1`.
- Approved provider operations: `provider.read` and `provider.compute`, currently allowlisted to Cortex `/knowledge/search` and `/oracle/chat`; outputs are retained as `aios.provider-result.v1` artifacts.
- Latest verified artifact: `/root/clawd/ai-os/artifacts/provider-read-compute-adoption-20260711T2227Z/validation-summary.json`.
- Default-on proof: `/root/clawd/ai-os/artifacts/openclaw-dogfood/v1-freeze-provider-workflows-final-20260711230332`.
- Latest local validation: full `npm test` passed—contracts 7/7, language adoption 10/10, governance 7/7, product health 269 syntax / 262 imports, operator completion claim allowed. Live Cortex provider workflows produced internal-only artifacts; default status/recovery are green.
- Local workflow dogfood: `/root/clawd/ai-os/artifacts/provider-workflow-dogfood/batch-20260711T225838Z`; 20/20 green executions across `research-synthesis`, `contradiction-review`, and `implementation-brief`, each with live provider read/compute, restart-safe reuse, controlled provider-write denial, verifier evidence, and allowed bounded claim.
- Independent Hetzner qualification: `/home/jake/clawd-remote/ai-os/artifacts/provider-workflow-dogfood/remote-batch-final-20260711T2306Z`; exact 294-file source mirror, full suite green, separate 20/20 provider-fixture executions green, adapter workflow green.
- v1.1 evidence result on both execution sets: `keep_v1_frozen`; 20 successful runs, three workflows, zero recurring friction candidates, no automatic language change permitted.
- Active execution plane: Hetzner `/home/jake/clawd-remote/ai-os` for heavy runs; local `/root/clawd/ai-os` is the canonical product tree.

## Active blockers

- No blocker for canonical internal workflows or capability-gated provider read/compute.
- User-visible/external writes, arbitrary provider handoff, runtime replacement, and full product parity remain gated/not claimed.
- Future heavy runs still require explicit execution-plane placement and artifact truth checks.

## Next actions

1. Keep AIOS v1 frozen and continue collecting workflow friction in the execution ledger.
2. Open v1.1 design review only after threshold-qualified recurring friction and explicit operator approval.
3. Add any future provider or operation one capability family at a time, with negative tests and evidence-backed workflows; keep send/post/email/schedule/publish/deploy/provider-write blocked unless separately approved and proven.

## Do not use / superseded

- `/root/clawd/ai-os/plan.freeform-20260630-before-template.md` — historical concept draft only.
- `/root/clawd/ai-os/artifacts/**/reports/*plan*.md` — evidence/recovery plans only, not active strategy.
- Hetzner `/home/jake/clawd-remote/ai-os/.git` — nonfunctional/empty; do not treat as source of record.

## Truth boundary

Allowed claim:

- Canonical AIOS v1 is default-on for bounded internal workflows and capability-gated provider read/compute whose outputs remain internal artifacts, with local, live-Cortex, and independent Hetzner proof.

Not allowed:

- AI OS replaces Cortex/OpenClaw routing or the chat/control-plane brain.
- AI OS can perform user-visible or external writes without separate explicit approval.
- AI OS is full product parity or a complete operating system.
