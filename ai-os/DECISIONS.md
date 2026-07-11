# AI OS Decisions

Append-only durable decisions for AI OS. Keep current state in `STATUS.md`; keep strategy in `plan.md`.

## Decisions

## 2026-06-30 — Use `/root/clawd/ai-os/plan.md` as canonical plan

- Decision: Promoted AI OS from freeform concept into the workspace planning standard at `/root/clawd/ai-os/plan.md`.
- Reason: AI OS is a serious platform project with architecture, agents, evidence, and truth-boundary risk.
- Evidence: `/root/clawd/ai-os/plan.md`; original draft preserved at `/root/clawd/ai-os/plan.freeform-20260630-before-template.md`.
- Supersedes: freeform plan as active instructions.
- Follow-up: Keep freeform draft archive-only.

## 2026-07-03 — AI OS adapter is default-on but bounded

- Decision: AI OS adapter became default-on for local internal status/recovery/handoff/bounded jobs.
- Reason: The adapter path had green boot/run/verifier/recovery proof and is useful as internal substrate.
- Evidence: `/root/clawd/scripts/aios-adapter.mjs`; `/root/clawd/config/ai-os-adapter/default.json`; `/root/clawd/ai-os/artifacts/openclaw-dogfood/default-on-integration-20260703150217`.
- Supersedes: opt-in-only adapter usage.
- Follow-up: Do not claim runtime replacement, provider/external writes, or benchmark promotion without separate approval/proof.

## 2026-07-04 — Promote 6h continuation source state after terminal green

- Decision: Synced the terminal-green Hetzner 6h continuation source tree into local `/root/clawd/ai-os`, validated, committed, and pushed.
- Reason: Avoid “green but stranded on remote”; make the run durable in source control.
- Evidence: run `aios-language-toolchain-45a12w-6h-continuation-r1-20260704T021924Z`; promotion pointer `/root/clawd/artifacts/ai-os/orchestration/latest-6h-continuation-green.json`; commit `13aa9a3ef`.
- Supersedes: previous local-only hardening commit `32e0eb89f` as latest AI OS source checkpoint.
- Follow-up: Keep runtime replacement/full parity claims gated.

## 2026-07-04 — Separate AI OS plan from Full Parity Engine plan

- Decision: Created a separate canonical Full Parity Engine plan at `/root/clawd/full-parity-engine/plan.md` and updated AI OS plan with a planning map/confusion guard.
- Reason: Full parity is cross-project objective/truth infrastructure, not just an AI OS implementation phase.
- Evidence: commit `b815dcb0a`; `/root/clawd/docs/PLAN_INDEX.md`.
- Supersedes: treating AI OS plan as the place for every future parity/autonomy roadmap.
- Follow-up: Use FPE plan for matrix/negative-space/parity engine work.

## 2026-07-04 — Adopt plan lifecycle files

- Decision: AI OS now uses `plan.md` for strategy, `STATUS.md` for current checkpoint, and `DECISIONS.md` for durable choices.
- Reason: Prior plans mixed roadmap, checkpoint, and decision history, causing confusion during long-running campaigns.
- Evidence: `/root/clawd/ai-os/STATUS.md`; `/root/clawd/ai-os/DECISIONS.md`; `scripts/plan-doctor.mjs`.
- Supersedes: updating `plan.md` as a running diary.
- Follow-up: Run `node scripts/plan-doctor.mjs` after lifecycle edits.

## 2026-07-11 — Canonicalize AIOS v1 and make source compilation the default internal adapter path

- Decision: New AIOS integrations use `.aios` `job-block-v1` source, `compileCanonicalAiosSource`, the `aios compile` operator command, and a compiled runtime job executed through mediated kernel syscalls. The default OpenClaw adapter now auto-compiles `.aios` source; older parser/compiler exports remain compatibility-only.
- Reason: Broad adoption required one understandable source→compiler→runtime contract and a real dogfooded workflow, not multiple equivalent entrypoints or JSON-only adapter execution.
- Evidence: `/root/clawd/ai-os/artifacts/language-adoption-20260711T211822Z/validation-summary.json`; `/root/clawd/ai-os/docs/LANGUAGE_V1.md`; default proof `/root/clawd/ai-os/artifacts/openclaw-dogfood/language-v1-broad-adoption-final-20260711213346`.
- Boundary: Default adoption is bounded to `kernel.*` plus explicit `process.admit`/`process.transition` operations. External capabilities/handoffs fail closed. Cortex/OpenClaw remain the reasoning/control plane; runtime replacement, native OS readiness, external writes, and full parity are not promoted.
- Supersedes: Treating package-level `compileAiosSource` variants or hand-authored `.job.json` as the preferred new-integration path.
- Follow-up: Migrate additional low-risk internal workflows one capability family at a time, with negative tests and verifier-backed proof.
