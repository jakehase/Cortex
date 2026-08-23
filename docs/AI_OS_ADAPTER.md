# AI OS Adapter

Status: available but not enabled by the checked-in configuration. `config/ai-os-adapter/default.json` is an inactive template, not current operational evidence.

The adapter compiles canonical `.aios` source before bounded kernel execution. Cortex/OpenClaw remain the routing and control plane. Historical proof packets are qualification history only; current readiness requires fresh boot, process-completion, run, supported job-verifier, claim-binding, recovery, and explicit operator-approval evidence.

## Boundary

- The only reviewed provider transport policy is `ai-os/kernel/policy/provider-read-compute.json`. Its normalized digest is pinned in the runtime; arbitrary origins and routes fail closed.
- `provider.read` and `provider.compute` both issue externally visible network `POST` requests. Receipts report `externalWrites: true` and `externalTransportEffect: network-post`.
- Returned provider data stays in the selected AI OS artifact root and reports `resultStorageExternalWrites: false`. Remote endpoint side effects are `not_observable` here.
- User-visible publication, general provider writes, arbitrary handoff, deployment, and runtime replacement remain outside this boundary.
- The local replay verifier validates exact job/run/process/tenant/policy hashes, freshness, and a deliberately narrow set of job verifier contracts. Executable hashes detect verifier-version drift; they are not a cryptographic signature against a principal who can rewrite both source and artifacts.
- Live artifact roots stay inside `ai-os/` (or `/tmp` for the direct CLI test boundary).

## Explicit artifact commands

Until a candidate is explicitly promoted, status and recovery need an artifact root:

```bash
node scripts/aios-adapter.mjs status --artifact-root ai-os/artifacts/openclaw-dogfood/<run>
node scripts/aios-adapter.mjs recover --artifact-root ai-os/artifacts/openclaw-dogfood/<run>
node scripts/aios-adapter.mjs compile <source.aios> --artifact-root ai-os/artifacts/openclaw-dogfood/<run>
node scripts/aios-adapter.mjs boot --artifact-root ai-os/artifacts/openclaw-dogfood/<run>
node scripts/aios-adapter.mjs run <source.aios|job.json> --artifact-root ai-os/artifacts/openclaw-dogfood/<run>
node ai-os/apps/aios-verifier.mjs --job <job.json> --artifact-root ai-os/artifacts/openclaw-dogfood/<run>
node scripts/aios-adapter.mjs claim <source.aios|job.json> --artifact-root ai-os/artifacts/openclaw-dogfood/<run>
```

The removed `--write-verifier-evidence` adapter flag is rejected. Run the bound verifier entry point after the exact job run.

## Default promotion is two phase

The first command stages smoke and recovery evidence but does not alter the active default. It exits blocked and returns the exact approval and resume commands:

```bash
node scripts/aios-adapter.mjs promote-default --label candidate
```

Run the returned `aios approve` command as an approver/operator/admin, then resume the same staged root:

```bash
node ai-os/apps/aios-cli.mjs approve --artifact-root ai-os/artifacts/openclaw-dogfood/<candidate> --subject <claim-subject>
node scripts/aios-adapter.mjs promote-default --resume --artifact-root ai-os/artifacts/openclaw-dogfood/<candidate>
```

Smoke failure, recovery failure, missing/mismatched/stale approval, or verifier drift leaves the prior `state/ai-os-adapter/active-default.json` bytes unchanged. The active file is replaced atomically only after all gates pass.

## Frozen historical evidence

The repository contains a relocatable historical AIOS bundle at `ai-os/artifacts/language-adoption-20260711T211822Z/`. Its byte integrity can be replayed from the workspace root:

```bash
sha256sum -c ai-os/artifacts/language-adoption-20260711T211822Z/bundle-manifest.sha256
```

The bundle records July 2026 local and Hetzner results. Its stored green booleans, absolute capture paths, and earlier no-external-write wording do not establish current readiness and must not be used for current default promotion.
