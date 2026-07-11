# AI OS v0.1 Boot Sequence

This document began as the Wave 0 boot contract. Contract tests alone are still not runtime proof; the current hosted production slice now earns separate boot/run/verifier/claim proof through the commands below.

## Boot target

The first boot target is a hosted AI OS kernel running on Linux from `/root/clawd/ai-os`.

A current source-language boot proof requires canonical compile, boot, run, verifier evidence, and claim:

```bash
node apps/aios-cli.mjs compile examples/internal-adapter-status.aios --artifact-root artifacts/openclaw-dogfood/<run>
node apps/aios-cli.mjs boot --artifact-root artifacts/openclaw-dogfood/<run>
node apps/aios-cli.mjs run artifacts/openclaw-dogfood/<run>/internal-adapter-status.compiled.job.json --artifact-root artifacts/openclaw-dogfood/<run>
node --test tests/language-adoption.test.mjs
```

The default adapter dogfood additionally writes verifier evidence and submits the bounded claim.

## Required boot phases

1. **Load contracts** — process, capability, syscall, verifier, and claim schemas parse and match `kernel_contract.json`.
2. **Initialize artifact root** — create or verify `artifacts/aios-v0/latest`.
3. **Start audit stream** — every kernel decision must append an audit event.
4. **Register built-in syscalls** — v0.1 starts with `fs.read`, `fs.write`, `shell.exec`, `git.diff`, `memory.search`, `memory.write`, `verifier.run`, `claim.submit`, and `audit.write`.
5. **Load capability policy** — default deny for external writes, destructive actions, deploys, and privileged kernel changes.
6. **Compile and admit an AIOS job** — compile canonical `.aios` source, then create a process from the emitted job descriptor.
7. **Run verifiers** — execute the verifier contract attached to the job.
8. **Submit claim** — allow completion only if evidence artifacts exist and verifier state is green.
9. **Write boot proof** — produce `boot_proof.json`, `process_lifecycle.json`, `capability_audit.json`, `syscall_audit.json`, `claim_gate.json`, and `artifact_bundle_manifest.json`.

## Truth boundary

Passing Wave 0 contract tests proves only that the boot contract is specified and internally consistent. Current runtime claims require the separate compile/boot/run/verifier/claim artifact chain. That chain proves only the bounded hosted production slice—not native OS replacement, external-provider readiness, or full product parity.
