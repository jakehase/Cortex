# AI OS v0.1 Boot Sequence

This document defines the intended boot proof for the first hosted AI OS kernel. It is a Wave 0 contract artifact, not proof that the runtime exists yet.

## Boot target

The first boot target is a hosted AI OS kernel running on Linux from `/root/clawd/ai-os`.

The first real boot proof will be allowed only when these commands exist and pass:

```bash
node apps/aios-cli.mjs boot --artifact-root artifacts/aios-v0/latest
node apps/aios-cli.mjs run examples/hello.job.json --artifact-root artifacts/aios-v0/latest
node apps/aios-cli.mjs claim examples/hello.job.json --artifact-root artifacts/aios-v0/latest
node --test tests/kernel-lifecycle.test.mjs
```

## Required boot phases

1. **Load contracts** — process, capability, syscall, verifier, and claim schemas parse and match `kernel_contract.json`.
2. **Initialize artifact root** — create or verify `artifacts/aios-v0/latest`.
3. **Start audit stream** — every kernel decision must append an audit event.
4. **Register built-in syscalls** — v0.1 starts with `fs.read`, `fs.write`, `shell.exec`, `git.diff`, `memory.search`, `memory.write`, `verifier.run`, `claim.submit`, and `audit.write`.
5. **Load capability policy** — default deny for external writes, destructive actions, deploys, and privileged kernel changes.
6. **Admit hello job** — create a process from `examples/hello.job.json`.
7. **Run verifiers** — execute the verifier contract attached to the job.
8. **Submit claim** — allow completion only if evidence artifacts exist and verifier state is green.
9. **Write boot proof** — produce `boot_proof.json`, `process_lifecycle.json`, `capability_audit.json`, `syscall_audit.json`, `claim_gate.json`, and `artifact_bundle_manifest.json`.

## Truth boundary

Passing Wave 0 contract tests proves only that the boot contract is specified and internally consistent. It does not prove the AI OS kernel can boot. Runtime boot proof is Wave 1.
