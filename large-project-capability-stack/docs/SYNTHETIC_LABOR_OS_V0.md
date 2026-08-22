# Synthetic Labor OS v0

Synthetic Labor OS v0 is a thin control-plane product shell around the existing orchestration primitives. Its job is not to spawn chaos; its job is to make work legible, testable, reviewable, and honestly claimable.

> 2026-07-07 consolidation note: SLOS v1-v18 pilots/tournaments and direct Codex work-item wrappers are archived under `_quarantine/synthetic-labor-os-legacy-20260707/` and are no longer active package commands. Use `npm run ops:synthetic-labor-os:legacy:manifest` to inspect the recovery manifest before replaying any of them. Active control-plane scripts remain in `apps/synthetic-labor-os/`.

## Why tests are first-class

Unit tests are the coordination contract for agent work. With one developer, tests catch regressions. With many agents, tests also become the shared language that tells each worker: this is the behavior you must preserve while changing your slice.

For v0 jobs, a test contract should name:

- the invariants that cannot regress
- the commands that prove those invariants
- the evidence files that completion claims must reference
- the scope boundary, so a scoped pass does not become a broad claim

This is why the OS records `test_contract.json` and `test_evidence.json` beside the job, not as a chat note.

## Why docs/comments matter

The documentation style for Synthetic Labor OS is JSDoc/TypeDoc-inspired: exported contracts should explain why the boundary exists, what assumption it protects, and what future direction it enables.

Good comments are not narration like “increment i.” Good comments answer:

- why this state transition exists
- why approval is record-only instead of merge/publish credit
- why heavy execution requires an execution plane
- why a proof artifact is scoped and what it does not prove

That kind of documentation helps human reviewers and AI workers generate better tests.

## Bounded self-improvement loop

The OS supports a safe RSI-shaped loop, but deliberately keeps it bounded:

1. observe logs, failed tests, review decisions, or blockers
2. create an improvement proposal
3. require gates: tests, truth-boundary preservation, and human/validator review
4. only then implement a normal patch

The system must not auto-apply self-modifying changes from its own proposal. Improvement proposals are inputs to review, not permission to rewrite the control plane.

## v0 proof boundaries

- `demo_proof.json` proves the local OS shell flow: intake, compile, queue, demo execution evidence, review, tests, truth dashboard, and scoped completion.
- `100_agent_scale_proof.json` admits an existing verified execution-plane artifact. It does not launch heavy workers from the control-plane host.
- `operator_dashboard.json` is read-only. It does not approve, merge, publish, or complete anything by itself.

If a claim is larger than the artifact’s declared boundary, it is not a valid Synthetic Labor OS v0 claim.

## v1 continuation: local execution loop

The next product slice after v0 is a small local runner. It is intentionally not a 100-agent launcher. Its purpose is to prove the OS can move a queued job through an actual execution loop:

1. read a queued job record
2. build an execution plan
3. run deterministic local commands for low-scale work
4. write command logs and worker-run evidence
5. attach test evidence
6. write `artifact_bundle_manifest.json` with SHA256 checksums for the run artifacts
7. run a claim gate
8. complete the job only when the gate is green, otherwise block it

CLI:

```bash
node apps/synthetic-labor-os/local-runner.mjs --job artifacts/synthetic-labor-os-v1/latest/jobs/<job>.json --artifact-root artifacts/synthetic-labor-os-v1/latest
```

Safety boundary:

- local runner is for low-scale deterministic commands only
- it does not merge, publish, send externally, or launch heavy agent swarms
- artifact bundle checksums prove only that listed files match recorded bytes
- 25+ agent work still requires execution-plane readiness/provenance
- completion is scoped to the job contract and claim gate

One-command pilot:

```bash
npm run ops:synthetic-labor-os:legacy:manifest # archived; recover before replay
```

Default artifact root:

`artifacts/synthetic-labor-os-v1/latest`

## v2 continuation: remote execution-plane dispatch

The next slice moves from local execution to a real control-plane/execution-plane boundary. The control plane creates the job and owns the claim gate; the execution plane runs the bounded work and returns artifacts.

One-command remote pilot:

```bash
npm run ops:synthetic-labor-os:legacy:manifest # archived; recover before replay
```

Default execution plane:

- host: `jake@37.27.129.239`
- repo: `/home/jake/clawd-remote/large-project-capability-stack`
- local artifact root: `artifacts/synthetic-labor-os-v2/latest`

Remote dispatch evidence must include:

- `remote_dispatch_manifest.json`
- `sync_proof.json` with matching local/remote SHA256 hashes
- remote runner stdout/stderr/logs
- returned remote artifacts with `artifact_bundle_manifest.json`
- `artifact_integrity.json` verifying the returned bundle
- `remote_dispatch_result.json`

Safety boundary:

- remote dispatch is bounded and low-scale by default
- no merge, publish, external send, or public action
- no heavy swarm launch from the control plane
- if code sync, remote run, claim gate, artifact return, or bundle integrity is red, the job must stay blocked

The default v2 remote pilot command is intentionally remote-safe:

```bash
node --test tests/synthetic-labor-os-remote-smoke.test.mjs
```

That smoke test avoids depending on broader control-plane workspace files that may not exist on the execution-plane mirror.

## v3 remote Codex agent work-item pilot

The v3 pilot runs one bounded real Codex CLI work item on the execution plane and returns its provenance artifacts through the same OS job/claim-gate path:

```bash
npm run ops:synthetic-labor-os:legacy:manifest # archived; recover before replay
```

The pilot command is intentionally read-only from the Codex worker's point of view. The remote command invokes `_quarantine/synthetic-labor-os-legacy-20260707/apps/synthetic-labor-os/codex-agent-work-item.mjs`, which:

- verifies the configured Codex binary is available on the remote host,
- builds a bounded read-only `context_pack.json` from the SLOS package, v3 wrapper/pilot, and docs,
- runs `codex exec` with `--sandbox read-only`, `--json`, `--ephemeral`, and an output schema,
- writes context pack, prompt, schema, JSONL event stream, stderr, last-message, and `codex_agent_proof.json` artifacts,
- requires the structured final output to include the `SLOS_CODEX_AGENT_WORK_ITEM_DONE` marker and the exact truth boundary,
- rejects outputs where the agent declines to inspect the supplied context pack,
- exits nonzero unless the Codex invocation and structured output both verify.

Truth boundary: v3 proves one bounded read-only remote Codex CLI work item with returned artifacts. It does not merge, publish, send externally, implement product code, prove provider-token usage beyond observed CLI JSONL token fields, or prove broad/high-scale orchestration.

## v4 remote Codex patch-proposal pilot

The v4 pilot advances from read-only agent observation to a reviewable work product:

```bash
npm run ops:synthetic-labor-os:legacy:manifest # archived; recover before replay
```

The remote command invokes `_quarantine/synthetic-labor-os-legacy-20260707/apps/synthetic-labor-os/codex-patch-proposal-work-item.mjs`, which:

- builds a bounded read-only context pack,
- asks Codex for a structured patch proposal,
- writes `patch_proposal.diff` and `codex_patch_proposal_proof.json`,
- restricts the diff to an allowed target path,
- verifies the diff with `git apply --check --whitespace=nowarn`,
- snapshots target files before/after verification to prove the patch was not applied,
- returns the patch/proof artifacts through remote dispatch.

Truth boundary: v4 proves a bounded remote Codex patch proposal can become review-ready. It does not apply, merge, publish, send externally, or claim the patch as implemented product work.

## v5 operator review/apply gate

The v5 pilot consumes a returned v4 patch proposal only after an explicit approval artifact exists:

```bash
npm run ops:synthetic-labor-os:legacy:manifest # archived; recover before replay
```

The local command invokes `apps/synthetic-labor-os/apply-patch-gate.mjs`, which:

- verifies `operator_approval.json` is explicit and patch-specific,
- restricts the patch to approved target files,
- snapshots target files before applying,
- runs `git apply --check --whitespace=nowarn`,
- applies the patch to the local worktree,
- snapshots target files after applying,
- runs validation commands,
- writes `patch_apply_gate_proof.json`.

Truth boundary: v5 may prove one approved patch was applied to the current worktree and validated. It does not merge, publish, deploy, send externally, or prove broad product completeness.

## v6 provenance chain

The v6 pilot links the scattered v4/v5 artifacts into one auditable chain:

```bash
npm run ops:synthetic-labor-os:legacy:manifest # archived; recover before replay
```

The chain verifies:

- the remote Codex patch proposal was green and unapplied at proposal time,
- the patch SHA stayed stable from proposal to apply,
- the approval artifact was explicit, actor-bound, target-bound, and patch-specific,
- the apply gate changed only the approved target files,
- validation passed after apply,
- prohibited actions such as merge/publish/deploy/external-send remain outside scope.

Truth boundary: v6 proves artifact lineage and claim integrity for one approved patch. It does not merge, publish, deploy, send externally, prove broad-scale orchestration, or prove full product completeness.

## v7 replay, rollback, and tamper audit

```bash
npm run ops:synthetic-labor-os:legacy:manifest # archived; recover before replay
```

v7 replays the v6 provenance chain, verifies that the applied patch has a dry-run rollback path via `git apply --reverse --check`, and runs negative/tamper cases that must fail closed. It does not actually roll back the worktree.

## v8 one-command E2E demo

```bash
npm run ops:synthetic-labor-os:legacy:manifest # archived; recover before replay
```

v8 packages the existing green v4/v5 real artifacts with fresh v6/v7 verification into a single end-to-end trace: objective → remote Codex patch proposal → approval/apply → provenance → replay/rollback/tamper hardening. By default it does not launch a new remote Codex call.

## v9 finished-claim report

```bash
npm run ops:synthetic-labor-os:legacy:manifest # archived; recover before replay
```

v9 turns the audited matrix and v6/v7/v8 proofs into an operator-facing finished-claim report. It authorizes only a bounded internal claim for the SLOS v0/v10 productization sequence, not a public/full/autonomous-labor claim.

## v10 scale smoke finish gate

```bash
npm run ops:synthetic-labor-os:legacy:manifest # archived; recover before replay
```

v10 runs the packaged E2E demo, finished-claim report, and local smoke commands. It is the bounded finish gate for this sequence. Green v10 means the v0 productization path is packaged and passing for the audited scope; it still does not merge, publish, deploy, send externally, or prove unlimited autonomous labor capability.

## v11 release bundle / handoff pack

```bash
npm run ops:synthetic-labor-os:legacy:manifest # archived; recover before replay
```

v11 packages the green v10 evidence into an internal release bundle with:

- `release_manifest.json` containing copied artifact metadata and SHA256 checksums,
- `README.md` with the bounded claim, replay commands, and included artifact list,
- `SHA256SUMS` for copied bundle files.

The bundle is a handoff/audit package only. It does not merge, publish, deploy, send externally, or expand the v10 claim beyond the audited bounded sequence.

## v12 fresh replay

```bash
npm run ops:synthetic-labor-os:legacy:manifest # archived; recover before replay
```

v12 proves the proposal → approval → apply → provenance path can start from fresh inputs. It creates a new target path, dispatches a bounded remote Codex patch proposal, applies that returned patch through the approval gate, and builds a fresh provenance chain over the new artifacts.

## v13 operator doctor

```bash
npm run ops:synthetic-labor-os:legacy:manifest # archived; recover before replay
```

v13 is the operator UX/config validation surface. It checks required npm scripts, writes/validates local operator config, verifies latest v11/v12 evidence, and emits JSON/Markdown runbook output.

## v14 multi-job workload smoke

```bash
npm run ops:synthetic-labor-os:legacy:manifest # archived; recover before replay
```

v14 uses an isolated smoke repository to apply two approved jobs and prove a conflicting third job fails closed at the apply gate. It exercises multi-job behavior without touching the product worktree or external systems.

## v15 release-candidate gate

```bash
npm run ops:synthetic-labor-os:legacy:manifest # archived; recover before replay
```

v15 verifies v11/v12/v13/v14 evidence and runs smoke commands. Green v15 means this internal SLOS production slice is release-candidate ready for the audited scope only. It does not merge, publish, deploy, send externally, or claim unlimited autonomous labor capability.

## v16 20-iteration agent tournament

```bash
npm run ops:synthetic-labor-os:legacy:manifest # archived; recover before replay
```

v16 orchestrates 20 remote Codex proposal iterations on the execution plane. Each iteration gets a distinct target and angle, returns a review-ready patch proposal, and is scored by a deterministic rubric. The launcher applies only the selected best proposal through the approval/apply gate, then builds provenance for the winner.

Non-winning iterations remain proposals only. v16 does not merge, publish, deploy, send externally, apply non-winners, or claim unlimited autonomous labor capability.

## v17 architecture-showcase-style role-agent tournament

```bash
npm run ops:synthetic-labor-os:legacy:manifest # archived; recover before replay
```

v17 mirrors the architecture showcase pattern for Synthetic Labor OS:

- 20 candidates,
- 5 real Codex role-agents per candidate (`strategist`, `patch_author`, `test_writer`, `adversarial_reviewer`, `scorer_refiner`),
- 100 requested role-agent shards total,
- remote execution-plane worker farm with concurrency proof,
- candidate verification/scoring,
- one selected winner applied through the approval/apply gate,
- winner provenance chain.

This is the multi-agent version of the tournament. It does not merge, publish, deploy, send externally, apply non-winners, or claim unlimited autonomous labor capability.

## v18 whole-Synthetic-Labor-OS variant tournament

```bash
npm run ops:synthetic-labor-os:legacy:manifest # archived; recover before replay
```

v18 is the corrected full-target version of the role-agent tournament:

- 20 whole-SLOS implementation variants,
- 5 real Codex role-agents per variant (`systems_architect`, `runtime_implementer`, `test_engineer`, `adversarial_reviewer`, `release_scorer`),
- 100 requested role-agent shards total,
- remote execution-plane worker farm with concurrency proof,
- candidate patches must touch real SLOS runtime/CLI/core files and tests,
- docs-only candidates are rejected,
- each finalist patch is checked against an isolated repository copy,
- only one validated winner is applied locally through the approval/apply/provenance gates.

This is still an internal production slice. It does not merge, publish, deploy, send externally, apply non-winners, or claim unlimited autonomous labor capability.

## v19 run ledger / release packet

```bash
npm run ops:synthetic-labor-os:v19-release-packet
```

v19 productizes the v18 checksum-manifest winner into an operator-readable packet for a completed SLOS run. It now begins with the Cortex prior-art gate so the packet is explicitly an adapter over existing Cortex/SLOS truth-ledger primitives instead of a parallel ledger. It links, copies, and verifies the important evidence:

- Cortex prior-art gate result (`adapter_wrapper_only` / existing capability recall),
- proof-carrying claim ledger eligibility for the packet claim,
- original request / run summary,
- remote tournament summary and execution counts,
- selected winner patch and checksum,
- proposal proof,
- explicit operator approval,
- apply-gate summary/proof,
- validation/provenance chain,
- a copied evidence manifest plus SHA256 bundle manifest.

Green v19 means one bounded SLOS run has an audit-ready paper trail: what ran, what won, what was approved, what changed, what validated, and what claim is safe. It does not merge, publish, deploy, send externally, apply non-winners, or claim full product completeness.

## v20 hard remote multi-repo dogfood / v0.1 RC packet

```bash
npm run ops:synthetic-labor-os:v20-hard-dogfood-rc
```

v20 turns the hard dogfood from a scratch driver into an official replayable SLOS command. It is deliberately harder than a self-referential SLOS smoke:

- writes `dependency_sync_manifest.json` before launch,
- pre-syncs bounded public Cortex prior-art/Agent Work handoff files and Mailchimp smoke files to the execution plane with SHA256 proof,
- uses remote dispatch to hash-sync the SLOS/shared-stack code paths,
- runs the shared orchestration suite remotely,
- runs Cortex prior-art and structural-memory checks remotely,
- runs Mailchimp product smoke tests remotely,
- returns artifacts and verifies the returned bundle,
- writes `v20_release_candidate_packet.json` and Markdown.

A green v20 is a v0.1 release-candidate packet for the audited hard-dogfood scope only. It does not merge, publish, deploy, send externally, prove real multi-agent coding, or claim full product completeness.
