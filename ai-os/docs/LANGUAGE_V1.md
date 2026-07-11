# AIOS Language v1

Status: canonical internal and capability-gated provider read/compute production slice.

AIOS is a declarative, capability-first workflow language for bounded AI jobs. It is not a replacement for JavaScript, Python, Cortex reasoning, OpenClaw routing, or the host operating system.

## Canonical contract

New integrations use exactly this path:

1. **Source:** `.aios` files using the `job-block-v1` grammar.
2. **Parser/compiler frontend:** `packages/aios-language/api/compiler-api.mjs`.
3. **Canonical policy and runtime emitter:** `packages/aios-language/canonical.mjs`.
4. **Compiler API:** `compileCanonicalAiosSource(source, options)`.
5. **CLI:** `node apps/aios-cli.mjs compile <source.aios> --artifact-root <root>`.
6. **Runtime handoff:** emitted `*.compiled.job.json`, executed by `aios run` through mediated kernel syscalls.
7. **OpenClaw adapter:** `node scripts/aios-adapter.mjs run <source.aios> --artifact-root <root>` automatically compiles before execution.

`packages/aios-language/index.mjs` exports the canonical API. Older directive-oriented `compileAiosSource` exports remain only for compatibility; they are not the default adoption or runtime entrypoint.

Stable identifiers:

- Language: `aios.language.v1`
- Grammar: `job-block-v1`
- Compiler: `aios.language.compiler.canonical.v1`
- Emitted job: `aios.language-job.v1`
- Compile proof: `aios.language.compile.proof`
- Provider policy: `aios.provider-read-compute-policy.v1`
- Provider grants: `aios.provider-access.v1`
- Provider result: `aios.provider-result.v1`
- Freeze policy: `aios.language.freeze-policy.v1`
- v1.1 evidence review: `aios.language.v1.1-review.v1`

## Enforced v1 freeze

AIOS v1 is mechanically frozen, not merely documented as stable. `kernel/policy/language-v1-freeze.json` records the canonical language, grammar, compiler, source extension, declarations, provider operations, exact runtime operation allowlist, and their stable digest. `scripts/check-language-freeze.mjs` compares that policy to the live compiler surface and is part of `npm test`.

Allowed v1 work is limited to bug fixes, security hardening, and compatibility fixes. New keywords, symbols, runtime operations, provider operations, or grammar versions fail the freeze check unless an `aios.language.v1.1-review.v1` artifact records sufficient recurring execution evidence **and** explicit operator approval. Evidence alone opens design review; it never changes the language automatically.

The frozen runtime operations are exactly:

- `kernel.echo`, `kernel.record`, `kernel.artifact.status`, `kernel.complete`;
- `process.admit`, `process.transition`;
- `provider.read`, `provider.compute`.

## Minimal internal source

```aios
job adapterStatus {
  capability aios.status: read @internal;
  memory adapterArtifacts: persistent;
  step inspect uses kernel.artifact.status() reads [adapterArtifacts] -> status recover halt;
  verify status exists;
  truth adapterState: source="artifact-root", confidence="observed";
  rollback retain_artifacts;
}
```

A canonical job declares:

- one or more explicit capabilities;
- optional named memory resources;
- steps mapped to permitted internal or provider operations;
- at least one verifier contract;
- at least one truth-boundary declaration;
- recovery/rollback behavior.

## Capability-gated provider read and compute

The approved provider surface is deliberately narrow:

- `provider.read` requires `provider.<id>.read: read @external`;
- `provider.compute` requires `provider.<id>.compute: compute @external`;
- the provider, operation, POST path, model allowlist, response limit, and timeout come from `kernel/policy/provider-read-compute.json`;
- compilation embeds a tenant/workspace-bound grant and policy digest in the emitted job;
- runtime rejects missing capabilities, unknown providers, policy-digest drift, forged grants, scope mismatch, unallowlisted arguments/models/response modes, redirects, non-POST transport, invalid origins, oversized requests/responses, and non-2xx responses;
- complete provider responses are written only to `provider-results/<processId>/<ordinal>-<operation>.json` inside the selected artifact root;
- result receipts record `outputBoundary: internal-artifact-only` and `externalWrites: false`.

Example:

```aios
job cortexProviderAssist {
  capability provider.cortex.read: read @external;
  capability provider.cortex.compute: compute @external;
  memory providerArtifacts: persistent;
  step recall uses provider.read(provider: "cortex", query: "canonical AIOS language adoption", n_results: 3) writes [providerArtifacts] -> recallReceipt recover halt;
  step summarize uses provider.compute(provider: "cortex", prompt: "Return exactly: AIOS_PROVIDER_COMPUTE_OK", model: "tinyllama") writes [providerArtifacts] -> computeReceipt recover halt;
  verify provider result artifacts exist;
  truth providerState: source="provider-result-artifacts", confidence="observed";
  rollback retain_artifacts;
}
```

This `@external` declaration means the job may perform the specifically allowlisted provider read/compute request. It does **not** grant send, post, email, schedule, publish, deploy, mutate-a-remote-system, arbitrary URL, or provider-write authority.

## Compile and run

```bash
cd /root/clawd/ai-os
node apps/aios-cli.mjs compile examples/capability-gated-provider.aios \
  --artifact-root artifacts/openclaw-dogfood/provider-example
node apps/aios-cli.mjs boot \
  --artifact-root artifacts/openclaw-dogfood/provider-example
node apps/aios-cli.mjs run \
  artifacts/openclaw-dogfood/provider-example/capability-gated-provider.compiled.job.json \
  --artifact-root artifacts/openclaw-dogfood/provider-example
```

The default OpenClaw bridge performs compile→run directly:

```bash
cd /root/clawd
node scripts/aios-adapter.mjs boot \
  --artifact-root ai-os/artifacts/openclaw-dogfood/provider-example
node scripts/aios-adapter.mjs run ai-os/examples/capability-gated-provider.aios \
  --artifact-root ai-os/artifacts/openclaw-dogfood/provider-example
```

Use `--provider-policy <path>` on `aios compile`, `aios run`, or the adapter compile/run commands to select a different workspace policy. Compile and run must use the same normalized policy digest.

## Recurring provider workflows

Three production-slice workflows compose the existing frozen `provider.read` and `provider.compute` operations without adding language syntax:

- `research-synthesis` — grounded internal research note;
- `contradiction-review` — stale-claim and contradiction audit;
- `implementation-brief` — bounded implementation brief grounded in retrieved project truth.

Each invocation performs read → synthesis → restart-safe completed-record reuse → controlled `provider.write` denial → verifier evidence → bounded completion claim. Retrieval and synthesis artifacts stay inside the selected AIOS artifact root and carry provenance hashes. Run one through the canonical adapter:

```bash
cd /root/clawd
node scripts/aios-adapter.mjs provider-workflow \
  --workflow research-synthesis \
  --query "current canonical AIOS project status"
```

Or run the fixed 20-case dogfood set and evaluate the v1.1 evidence gate:

```bash
cd /root/clawd/ai-os
npm run dogfood:provider -- --artifact-root artifacts/provider-workflow-dogfood/<batch>
npm run review:language-v1.1 -- \
  --ledger artifacts/provider-workflow-dogfood/<batch>/ledger.jsonl \
  --output artifacts/provider-workflow-dogfood/<batch>/language-v1.1-review.json
```

## Runtime mapping

The canonical compiler emits a runtime-compatible job with:

- source hash, language/grammar/compiler identity;
- tenant and workspace boundary;
- declared capabilities and memory;
- ordered syscall descriptors derived from source steps;
- verifier contracts and truth boundaries;
- job and per-step recovery instructions;
- policy-bound provider grants when provider read/compute is requested.

Compilation writes `packets/language-compile.packet.json`. Runtime execution writes boot, run, process, audit, verifier, claim, and provider-result evidence.

## Fail-closed boundary

The compiler permits only the exact frozen runtime operation list above. It blocks:

- all other external capabilities and runtime adapters;
- provider access without an exact declared capability and active policy grant;
- provider write/send/post/email/schedule/publish/deploy operations;
- arbitrary provider origins, paths, methods, models, and redirects;
- jobs without a capability, verifier contract, or truth boundary;
- compiler output that is not export-ready.

This path does not replace Cortex/OpenClaw routing, expose user-visible or external writes, deploy software, replace the runtime, or promote benchmark output. Any such expansion requires separate explicit approval, implementation, and artifact-backed promotion.

## Adoption gate

Run:

```bash
npm run test:language-adoption
npm test
```

The language-adoption and governance suites verify canonical compilation, package-facade export, freeze-policy integrity, exact runtime operation enforcement, required declarations, quote-aware provider prompts, fail-closed external writes, missing/invalid grants, provider/model/transport allowlists, deterministic read+compute over a local HTTP fixture, internal-artifact-only outputs, CLI compile→execute, recurring workflow compilation, evidence thresholds, and default adapter source auto-compilation.
