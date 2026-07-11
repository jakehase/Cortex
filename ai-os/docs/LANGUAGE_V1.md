# AIOS Language v1

Status: canonical internal compile-to-kernel production slice.

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

## Minimal source

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
- steps mapped to internal `kernel.*` or `process.*` operations;
- at least one verifier contract;
- at least one truth-boundary declaration;
- recovery/rollback behavior.

## Compile and run

```bash
cd /root/clawd/ai-os
node apps/aios-cli.mjs compile examples/internal-adapter-status.aios \
  --artifact-root artifacts/openclaw-dogfood/language-example
node apps/aios-cli.mjs boot \
  --artifact-root artifacts/openclaw-dogfood/language-example
node apps/aios-cli.mjs run \
  artifacts/openclaw-dogfood/language-example/internal-adapter-status.compiled.job.json \
  --artifact-root artifacts/openclaw-dogfood/language-example
```

The default OpenClaw bridge performs compile→run directly:

```bash
cd /root/clawd
node scripts/aios-adapter.mjs boot \
  --artifact-root ai-os/artifacts/openclaw-dogfood/language-example
node scripts/aios-adapter.mjs run ai-os/examples/internal-adapter-status.aios \
  --artifact-root ai-os/artifacts/openclaw-dogfood/language-example
```

## Runtime mapping

The canonical compiler emits a runtime-compatible job with:

- source hash, language/grammar/compiler identity;
- tenant and workspace boundary;
- declared capabilities and memory;
- ordered syscall descriptors derived from source steps;
- verifier contracts and truth boundaries;
- job and per-step recovery instructions;
- provider/lifecycle handoff metadata from the compiler frontend.

Compilation writes `packets/language-compile.packet.json`. Runtime execution writes the existing boot, run, process, audit, verifier, and claim evidence.

## Fail-closed boundary

The default compiler permits bounded `kernel.*` operations plus the explicit `process.admit` and `process.transition` operations. It blocks:

- capabilities declared `@external`;
- external provider handoffs;
- non-kernel/process runtime adapters;
- jobs without a capability;
- jobs without verifier contracts;
- jobs without a truth boundary;
- compiler output that is not export-ready.

This path does not expose external writes, provider execution, deployments, runtime replacement, or benchmark promotion. Those require separate approval, implementation, and artifact-backed promotion.

## Adoption gate

Run:

```bash
npm run test:language-adoption
npm test
```

The language-adoption suite verifies canonical compilation, package-facade export, fail-closed external-effect policy, required declarations, CLI compile→execute, and default adapter source auto-compilation.
