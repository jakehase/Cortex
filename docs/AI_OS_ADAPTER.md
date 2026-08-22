# AI OS Adapter

Status: default-on canonical frozen-AIOS-v1 compile→execute substrate for local status, recovery, handoff, and capability-gated provider read/compute workflows.

The adapter compiles canonical `.aios` source before kernel execution. It is on by default for bounded internal status/recovery/handoff plus three recurring provider read/compute workflows while preserving the control-plane boundary: it does **not** replace Cortex/OpenClaw routing or the chat brain, and it exposes no provider writes or user-visible external actions.

## Boundary

- Default-on for local/internal status, recovery, handoff, bounded internal AIOS language jobs, and `research-synthesis`, `contradiction-review`, and `implementation-brief`.
- AIOS v1 is mechanically frozen; surface expansion requires threshold-qualified execution evidence and explicit operator approval.
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
node scripts/aios-adapter.mjs provider-workflow --workflow research-synthesis --query "current canonical project status"
```

Promotion/proof command:

```bash
node scripts/aios-adapter.mjs promote-default --label default-on-integration
```

## Current default-on proof

Default-on promotion passed at:

`/root/clawd/ai-os/artifacts/openclaw-dogfood/v1-freeze-provider-workflows-final-20260711230332`

Observed proof:

- adapter: `openclaw-aios-adapter.v0.6-v1-freeze-provider-workflows`
- canonical source: `adapter-dogfood.aios`
- canonical compiler: `aios.language.compiler.canonical.v1`
- compile proof green and compiled job emitted
- exact frozen runtime-operation allowlist enforced; unknown `kernel.*` operations fail closed
- three provider workflows available through the canonical adapter entrypoint
- local 20/20 live-Cortex workflow executions green with internal-only provider artifacts, restart reuse, controlled provider-write denial, verifier evidence, and allowed claims
- boot and run proofs green
- process and logs visible
- verifier evidence green
- completion claim `claimStatus=allowed`
- recovery report green, including canonical-language source/compile checks
- `node scripts/aios-adapter.mjs status` and `recover` work with no root flags
- independent Hetzner source-manifest match, full `npm test`, separate 20/20 provider-fixture batch, and adapter workflow proof passed

Validation after promotion:

```bash
cd /root/clawd && node --check scripts/aios-adapter.mjs
cd /root/clawd && node scripts/aios-adapter.mjs status
cd /root/clawd && node scripts/aios-adapter.mjs recover
cd /root/clawd/ai-os && npm test
```

Observed 2026-07-11 local and Hetzner results: 7/7 contract tests, 10/10 language-adoption tests, 7/7 governance tests, product health (269 syntax / 262 import checks), and source-language operator smoke passed. Both 20-run evidence reviews returned `keep_v1_frozen`; no automatic language change is allowed.

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
