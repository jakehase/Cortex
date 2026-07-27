# Semantic Coding-Transfer Contract

## Status

This document defines the Cortex Learning OS v0.9 production-slice contract. Release tests qualify the implementation and fail-closed routing machinery; they do not fabricate transfer evidence. No profile is checked in as qualified, and active mode injects nothing until the control plane installs an independently qualified transfer entry.

## Five separate truth layers

1. **Mathematical mastery** records adaptive math evidence only.
2. **Coding-transfer state** records whether a declared profile has separately passed a bounded transfer qualification.
3. **Transfer registry state** records whether the control plane installed an independently qualified, signed, enabled, unexpired entry.
4. **Runtime answer influence** records whether active mode actually rendered bounded context for an applicable turn.
5. **Empirical benefit** requires replayable comparative evidence and is not claimed in v0.9.

No layer implies the next. In particular, math mastery and keyword overlap cannot qualify or activate coding transfer.

## Declared profiles

`exact-multiplication` is limited to software requests that explicitly require integer operands, exact products, and arbitrary-precision or overflow-safe behavior. Its deterministic oracle compares the complete signed decimal product using independent exact integer arithmetic. Floating-point, approximation, cryptographic primitives, and required fixed-width hardware semantics are negative gates.

`algebra-factoring` is limited to exact univariate integer-polynomial construction, coefficient convolution/expansion, integer-root checking, and exact zero verification. Authentication factor, multi-factor authentication, refactor/refactoring, Factorio, business/risk/human/market factor, generic factor language, and approximate root finding are rejected.

Profiles contain no executable matcher logic or registry-provided regular expressions. Matcher IDs select source-controlled enumerated implementations.

## State and signing boundary

Transfer state uses its own owner-only HMAC secret and atomic revisioned file:

```text
/root/.openclaw/cortex-learning-os/transfer-state.json
/root/.openclaw/cortex-learning-os/transfer-state.hmac
```

Initialization enumerates the exact 36-node curriculum. `number-fractions` and `algebra-factoring` begin `unassessed` because they have declared profiles. The remaining 34 records begin `no_qualified_transfer` with reason `no-declared-transfer-surface`. Nothing reads or mutates `mastery.json`.

Applied run receipts bind each run ID to the exact artifact-manifest digest. A retry with the same receipt is idempotent. A different digest under the same run ID is rejected.

## Qualification protocol

`transfer:plan` freezes one profile, the v0.9 policy, source/base commit, seeded fresh task set, finite budgets, both arms, and all terminal outcomes into a signed plan. The plan signature can be verified by the control plane; workers receive the signed document but no secret.

Task families are:

- acquisition;
- fresh run-seeded held-out transfer;
- negative semantic cases;
- assumption violations;
- regression cases.

Each task is evaluated in `candidate` and `no-transfer` arms. Workers emit attempts and an inert proposal only. The control plane requires exact manifest coverage, re-derives the task set, recomputes semantic decisions, reruns local deterministic oracles, separates valid from invalid trials, recomputes metrics and gates, and then records one of:

```text
qualified | candidate | no-transfer | invalid | blocked | underpowered | null
```

Only `qualified` with every gate true can be signed into transfer state. Application never installs a registry entry. `transfer:promote` is a later explicit control-plane step and accepts only a coherent qualified state bound to one run, manifest, evidence digest, qualification time, and expiry.

No worker receives a state or registry signing secret.

## Runtime protocol

The live plugin keeps the existing signed lesson path unchanged and evaluates transfer independently.

Transfer defaults:

```json
{
  "transferEnabled": true,
  "transferMode": "active",
  "transferKillSwitch": false
}
```

The operator explicitly selected direct active publication after green release tests instead of a prolonged shadow rollout. Active-default does not bypass qualification: an empty registry, unqualified profile, invalid signature, expired entry, missing assumption, or negative gate returns no transfer system context. Explicit shadow mode remains available for future experiments and always has zero answer influence.

Active context is possible only when all checks pass:

- transfer is enabled;
- mode is `active`;
- transfer kill switch is off;
- agent and session scope are allowed;
- the independent transfer secret and signed registry validate;
- registry and entry are enabled;
- entry is `qualified` and unexpired;
- source-controlled matcher reports a software context;
- every observable assumption is present;
- no negative gate is present;
- the entry itself allows the agent;
- rendered context stays within its character bound.

The rendered context identifies applicability, observed assumptions, contraindications, computational formulation, bounded implementation patterns, deterministic oracle, complexity/numerical risks, evidence digest, expiry, and truth boundary. It requires independent implementation and verification and prohibits broad capability claims.

A transfer registry or telemetry failure does not disable, rewrite, or contaminate the signed lesson registry. The two paths fail closed independently.

## Privacy and filesystem boundary

Transfer telemetry is separate, owner-only, atomically written, and capped. Records contain timestamps, outcome/reason codes, profile and matcher IDs, observed assumption and negative-gate codes, registry revision/key ID, evidence digests, and the boolean answer-influence result. They never contain user prompts, code, answers, rendered context, profile prose, or lesson prose.

All generated plans, attempts, reports, state, registries, secrets, and telemetry belong outside Git under an owner-only state or artifact root. The plugin performs no deployment, service restart, canonical sync, remote write, or external action. External writes and deployments remain separately approval-gated.

## Operations

Initialize empty signed transfer state and registry:

```bash
npm run transfer:init
```

Inspect the separate truth layers:

```bash
npm run transfer:status
npm run transfer:verify
npm run transfer:registry
```

Create an inert plan:

```bash
npm run transfer:plan -- \
  --profile exact-multiplication \
  --run-id transfer-<approved-id> \
  --model gpt-5.6-sol \
  --reasoning xhigh \
  --out /root/.openclaw/cortex-learning-os/transfer-runs/transfer-<approved-id>
```

Independently replay returned artifacts and apply only the signed transfer-state result:

```bash
npm run transfer:apply -- \
  --artifacts /root/.openclaw/cortex-learning-os/transfer-runs/transfer-<approved-id>
```

An authorized operator may separately promote a qualified state, disable it, or revoke it:

```bash
npm run transfer:promote -- --profile exact-multiplication
npm run transfer:disable -- --profile exact-multiplication
npm run transfer:revoke -- --profile exact-multiplication
npm run transfer:registry:disable
```

Direct active-mode configuration is part of this release. Promotion remains a separate evidence-gated control-plane action; implementation tests alone cannot create or promote a qualified profile.

## Default configuration example

See [`openclaw-transfer-active.example.json`](openclaw-transfer-active.example.json). Paths are the intended live paths; the example is documentation and does not modify live configuration.

## Executable qualification worker

`npm run transfer:run -- --artifacts <frozen-root> --model <model> --reasoning <effort> --concurrency <1-8>`
executes the already-frozen `plan.json`/`tasks.json` pair. The production adapter is
the canonical `codex exec` command frozen by the control-plane runtime contract.
A non-Codex test plan may provide an argument-array adapter with `--model-command`
and repeated `--model-arg` flags, but a production Codex plan rejects that override.
Prompts are supplied on stdin and subprocesses always run with `shell:false`. The literal adapter argument
`{output}` is replaced with an owner-only temporary JSONL output path for adapters
that cannot return JSONL on stdout.

Before any provider call, the worker checks the plan identity and shape, declared
profile, base source and frozen digests, policy and budget equality, exact ordered
task coverage, task-set digest, every task digest, and the signed plan's frozen
provider/model/reasoning/read-only/tool-free runtime contract. It can check that the
control-plane signature is structurally present, but deliberately receives no
signing secret and therefore cannot authenticate or create control-plane state.

Every task receives one `candidate` and one `no-transfer` call under one frozen
model/runtime configuration. The signed plan freezes a run-seeded task order and
balances which arm runs first across pairs, avoiding a fixed candidate-first bias.
Candidate context is rendered only from the checked-in
profile when the checked-in semantic router selects it, all required observable
assumptions are present, and no negative gate fires. Baseline prompts never contain
transfer context. Neither prompt contains the task's `expected` field.

Completed calls are checkpointed as unique task/arm-bound rows in owner-only
`attempts.json` and a capped, content-free `provider_calls.json`; the final proposal
is deterministically ordered. Resume verifies
the frozen configuration digest and all completed tuple, timestamp, model,
runtime-contract, command-identity, and status bindings before making another call.
Concurrent batches durably checkpoint successful peers even when another peer
fails, so resume does not repeat already-recorded calls. Tool events are rejected.
A completed
proposal manifest binds `provider_calls.json` byte-for-byte. The worker proposal
remains inert and untrusted: only `transfer:apply` authenticates the original plan,
requires positive provider-observed input/output usage for every call, replays
tasks, oracles, and gates, signs transfer state, and can support a later
separate registry operation.

Implementation tests use a deterministic fake adapter. They do not qualify either
profile and are not substitutes for a real two-arm provider run. A real run may
truthfully replay to `null` when both arms perform equally.
