# OpenClaw 2026.4.5 WhatsApp thread-binding staging port

## Purpose

This is the concrete staging scaffold for porting the existing WhatsApp thread-bound subagent fallback behavior onto upstream OpenClaw `2026.4.5`.

It does **not** mutate the live install by default.

## Artifacts

- patch script:
  - `/root/clawd/scripts/patch-openclaw-whatsapp-thread-bound-sessions-2026-4-5-staging.mjs`
- validated staging diff:
  - `/root/clawd/patches/openclaw-whatsapp-thread-bound-sessions-2026.4.5-staging.patch`
- upstream staging target used for validation:
  - `/tmp/openclaw-audit/pkg/package/dist/pi-embedded-DWASRjxE.js`

## What the staging patch does

It ports the old local behavior into the upstream `pi-embedded-*` subagent spawn path by:

1. adding `resolveSubagentSpawnConversationId(requester)`
2. adding `ensureCurrentConversationBindingForSubagentSpawn(params)`
3. changing `ensureThreadBindingForSubagentSpawn(params)` so it:
   - still uses `subagent_spawning` hooks when available
   - but falls back to **current-conversation binding** when those hooks are absent or non-ready
4. threading `cfg` into the bind call so thread-binding policy and intro/max-age helpers can be used

## Validation already performed

Validated on a staging copy, not the live install:

- patch application succeeded
- second run was idempotent (`Already patched.`)
- `node --check` passed on the patched staging bundle
- unified diff artifact was captured under `patches/`
- promoted the extracted package into a runnable staging tree:
  - `/root/clawd/_staging/openclaw-2026.4.5`
- initially blocked because the first install used `--ignore-scripts`; upstream relies on `scripts/postinstall-bundled-plugins.mjs` to install lazy-loaded bundled extension runtime deps
- after running the package postinstall in staging, the staged build became runnable for CLI checks
- verified with the staged binary:
  - patched module import: `pi-embedded import ok`
  - `node ./openclaw.mjs gateway status` succeeded and reported the live gateway correctly
  - `node ./openclaw.mjs status --deep` succeeded and reported healthy gateway/WhatsApp/memory-slot status against the live config
- added an isolated staged-runtime harness that evaluates the exact patched helper block from the staged `pi-embedded-DWASRjxE.js` bundle with mocks:
  - `/root/clawd/scripts/test-openclaw-2026-4-5-thread-binding-fallback.mjs`
- harness checks passed:
  - fallback binds current conversation when `subagent_spawning` hooks are absent
  - hook success short-circuits fallback when hooks already prepare binding
  - existing binding conflict returns the expected error

## How to test again on staging

```bash
mkdir -p /tmp/openclaw-audit/staging
cp /tmp/openclaw-audit/pkg/package/dist/pi-embedded-DWASRjxE.js /tmp/openclaw-audit/staging/pi-embedded-DWASRjxE.test.js
node /root/clawd/scripts/patch-openclaw-whatsapp-thread-bound-sessions-2026-4-5-staging.mjs \
  --file /tmp/openclaw-audit/staging/pi-embedded-DWASRjxE.test.js
node --check /tmp/openclaw-audit/staging/pi-embedded-DWASRjxE.test.js
```

## Next recommended step

Apply this scaffold to a full staged `openclaw@2026.4.5` install, then verify:

- gateway healthy
- WhatsApp linked
- `sessions_spawn(thread=true, mode="session")` works from an active WhatsApp conversation
- `cortex-memory-bridge` still works with `plugins.slots.memory = "cortex-memory-bridge"`

## Important note

This staging scaffold is intentionally specific to the currently observed upstream hashed file:
- `pi-embedded-DWASRjxE.js`

If upstream re-rolls bundle hashes again, reuse the same behavioral port, but do not assume the exact filename or exact string anchors will remain stable.
