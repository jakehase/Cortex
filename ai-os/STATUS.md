# AI OS Status

## Metadata

- Project slug: `ai-os`
- Canonical plan: `/root/clawd/ai-os/plan.md`
- Decisions log: `/root/clawd/ai-os/DECISIONS.md`
- Last updated: `2026-07-11`
- Status: `active`
- Current fidelity: `platform` / hosted AI OS production slices

## Current checkpoint

- Current state: canonical AIOS v1 `.aios` compile→execute plus capability-gated provider read/compute is implemented and promoted as the default bounded adapter workflow.
- Canonical identifiers: language `aios.language.v1`; grammar `job-block-v1`; compiler `aios.language.compiler.canonical.v1`; adapter `openclaw-aios-adapter.v0.5-provider-read-compute`; policy `aios.provider-read-compute-policy.v1`.
- Approved provider operations: `provider.read` and `provider.compute`, currently allowlisted to Cortex `/knowledge/search` and `/oracle/chat`; outputs are retained as `aios.provider-result.v1` artifacts.
- Latest verified artifact: `/root/clawd/ai-os/artifacts/provider-read-compute-adoption-20260711T2227Z/validation-summary.json`.
- Default-on proof: `/root/clawd/ai-os/artifacts/openclaw-dogfood/provider-read-compute-default-20260711222614`.
- Latest validation: local and Hetzner full `npm test` passed on an exact source mirror; contracts 7/7, language adoption 10/10, product health 263 syntax / 260 imports, operator completion claims allowed. Live Cortex read and compute both returned HTTP 200 and produced internal-only result artifacts; default status/recovery are green.
- Active execution plane: Hetzner `/home/jake/clawd-remote/ai-os` for heavy runs; local `/root/clawd/ai-os` is the canonical product tree.

## Active blockers

- No blocker for canonical internal workflows or capability-gated provider read/compute.
- User-visible/external writes, arbitrary provider handoff, runtime replacement, and full product parity remain gated/not claimed.
- Future heavy runs still require explicit execution-plane placement and artifact truth checks.

## Next actions

1. Migrate additional read/compute workflows only through named provider, path, argument, model, tenant/workspace, and output-boundary grants.
2. Add any new provider or operation one capability family at a time, with negative tests and one evidence-backed workflow.
3. Keep send/post/email/schedule/publish/deploy/provider-write behavior blocked unless separately approved and proven.

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
