# AI OS Adapter

Status: default-on canonical AIOS language compile→execute substrate for local status, recovery, handoff, and bounded internal jobs.

The adapter now compiles canonical `.aios` source before kernel execution. It is on by default for bounded internal status/recovery/handoff workflows while preserving the control-plane boundary: it does **not** replace Cortex/OpenClaw routing, the chat brain, provider execution, or external-write approval gates.

## Boundary

- Default-on for local/internal status, recovery, handoff, and bounded internal AIOS language jobs.
- Canonical path: `.aios` → `aios.language.compiler.canonical.v1` → runtime-compatible job JSON → mediated kernel syscalls.
- Legacy directive compilers remain compatibility exports, not the default adoption path.
- No external handoff/provider writes are exposed.
- Does not replace OpenClaw/Cortex routing or the chat/control-plane brain.
- Does not promote failed benchmark output; benchmark truth still comes from terminal artifacts.
- Live AI OS artifact roots stay inside `ai-os/artifacts/openclaw-dogfood/` because the AI OS CLI enforces its workspace boundary.
- Default config: `config/ai-os-adapter/default.json`.
- Default state: `state/ai-os-adapter/default-on-state.json`.
- Root-level pointer: `artifacts/ai-os/dogfood/latest-adapter-root.json`.

## Default commands

These now resolve the default-on artifact root without needing `--last` or `--artifact-root`:

```bash
node scripts/aios-adapter.mjs status
node scripts/aios-adapter.mjs recover
```

Explicit commands still work for a specific root:

```bash
node scripts/aios-adapter.mjs status --artifact-root ai-os/artifacts/openclaw-dogfood/<run>
node scripts/aios-adapter.mjs recover --artifact-root ai-os/artifacts/openclaw-dogfood/<run>
node scripts/aios-adapter.mjs compile <source.aios> --artifact-root ai-os/artifacts/openclaw-dogfood/<run>
node scripts/aios-adapter.mjs boot --artifact-root ai-os/artifacts/openclaw-dogfood/<run>
node scripts/aios-adapter.mjs run <source.aios|job.json> --artifact-root ai-os/artifacts/openclaw-dogfood/<run>
node scripts/aios-adapter.mjs ps --artifact-root ai-os/artifacts/openclaw-dogfood/<run>
node scripts/aios-adapter.mjs logs --artifact-root ai-os/artifacts/openclaw-dogfood/<run> --process <process-id>
node scripts/aios-adapter.mjs claim <source.aios|job.json> --artifact-root ai-os/artifacts/openclaw-dogfood/<run> --write-verifier-evidence
```

Promotion/proof command:

```bash
node scripts/aios-adapter.mjs promote-default --label default-on-integration
```

## Current default-on proof

Default-on promotion passed at:

`/root/clawd/ai-os/artifacts/openclaw-dogfood/language-v1-broad-adoption-final-20260711213346`

Observed proof:

- adapter: `openclaw-aios-adapter.v0.4-language-v1`
- canonical source: `adapter-dogfood.aios`
- canonical compiler: `aios.language.compiler.canonical.v1`
- compile proof green and compiled job emitted
- `kernel.artifact.status` executed through mediated syscall runtime
- boot and run proofs green
- process and logs visible
- verifier evidence green
- completion claim `claimStatus=allowed`
- recovery report green, including canonical-language source/compile checks
- `node scripts/aios-adapter.mjs status` and `recover` work with no root flags
- independent Hetzner source-manifest match, full `npm test`, and dogfood compile→run proof passed

Validation after promotion:

```bash
cd /root/clawd && node --check scripts/aios-adapter.mjs
cd /root/clawd && node scripts/aios-adapter.mjs status
cd /root/clawd && node scripts/aios-adapter.mjs recover
cd /root/clawd/ai-os && npm test
```

Observed 2026-07-11 local and Hetzner results: 7/7 contract tests, 6/6 language-adoption tests, product health (262 syntax / 259 import checks), and source-language operator smoke passed. The operator-smoke completion claim was allowed on both hosts.

## Prior proofs

Prior JSON-job default-on promotion passed at:

`/root/clawd/ai-os/artifacts/openclaw-dogfood/default-on-integration-20260703150217`

Initial adapter smoke passed at:

`/root/clawd/ai-os/artifacts/openclaw-dogfood/initial-wire-in-20260702212948`

Bounded real internal dogfood passed at:

`/root/clawd/ai-os/artifacts/openclaw-dogfood/real-internal-adapter-readiness-20260702T213855Z`

Recovery/status handoff proof passed at:

`/root/clawd/ai-os/artifacts/openclaw-dogfood/adapter-recovery-handoff-20260703T044114Z`

## Promotion rule after default-on

The adapter is now permanently enabled for internal substrate use. Future promotion to default runtime replacement, external tool/provider handoff, or benchmark-pass claims still requires separate explicit approval and proof. Keep Cortex/OpenClaw as the routing/control plane until a later, artifact-backed promotion explicitly changes that boundary.
