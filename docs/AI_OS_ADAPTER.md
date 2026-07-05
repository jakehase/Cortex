# AI OS Adapter

Status: default-on internal substrate for local AI OS status, recovery, and handoff.

This adapter wires the AI OS language/kernel substrate into the current OpenClaw workspace. It is now on by default for bounded internal status/recovery/handoff operations, while preserving the control-plane boundary: it does **not** replace Cortex/OpenClaw routing, the chat brain, provider execution, or external-write approval gates.

## Boundary

- Default-on for local/internal status, recovery, handoff, and bounded internal AI OS jobs.
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
node scripts/aios-adapter.mjs boot --artifact-root ai-os/artifacts/openclaw-dogfood/<run>
node scripts/aios-adapter.mjs run <job.json> --artifact-root ai-os/artifacts/openclaw-dogfood/<run>
node scripts/aios-adapter.mjs ps --artifact-root ai-os/artifacts/openclaw-dogfood/<run>
node scripts/aios-adapter.mjs logs --artifact-root ai-os/artifacts/openclaw-dogfood/<run> --process <process-id>
node scripts/aios-adapter.mjs claim <job.json> --artifact-root ai-os/artifacts/openclaw-dogfood/<run> --write-verifier-evidence
```

Promotion/proof command:

```bash
node scripts/aios-adapter.mjs promote-default --label default-on-integration
```

## Current default-on proof

Default-on promotion passed at:

`/root/clawd/ai-os/artifacts/openclaw-dogfood/default-on-integration-20260703150217`

Observed proof:

- adapter: `openclaw-aios-adapter.v0.3-default-on`
- boot proof green
- run proof green
- process visible
- logs visible
- verifier evidence green
- completion claim `claimStatus=allowed`
- recovery report green
- recovery plan written
- `node scripts/aios-adapter.mjs status` works with no root flags
- `node scripts/aios-adapter.mjs recover` works with no root flags

Validation after promotion:

```bash
cd /root/clawd && node --check scripts/aios-adapter.mjs
cd /root/clawd && node scripts/aios-adapter.mjs status
cd /root/clawd && node scripts/aios-adapter.mjs recover
cd /root/clawd/ai-os && npm test
```

Observed `npm test` result: 7/7 contract tests passed, product health passed, and operator smoke passed.

## Prior proofs

Initial adapter smoke passed at:

`/root/clawd/ai-os/artifacts/openclaw-dogfood/initial-wire-in-20260702212948`

Bounded real internal dogfood passed at:

`/root/clawd/ai-os/artifacts/openclaw-dogfood/real-internal-adapter-readiness-20260702T213855Z`

Recovery/status handoff proof passed at:

`/root/clawd/ai-os/artifacts/openclaw-dogfood/adapter-recovery-handoff-20260703T044114Z`

## Promotion rule after default-on

The adapter is now permanently enabled for internal substrate use. Future promotion to default runtime replacement, external tool/provider handoff, or benchmark-pass claims still requires separate explicit approval and proof. Keep Cortex/OpenClaw as the routing/control plane until a later, artifact-backed promotion explicitly changes that boundary.
