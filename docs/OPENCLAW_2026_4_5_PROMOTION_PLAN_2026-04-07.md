# OpenClaw 2026.4.5 live promotion plan — 2026-04-07

## Goal

Promote the already-validated staged OpenClaw `2026.4.5` build into the live install **without** losing the must-preserve WhatsApp thread-bound subagent/current-conversation binding behavior.

## Current truth

### Live install
- version: `2026.3.28`
- path: `/usr/lib/node_modules/openclaw`
- service command: `/usr/bin/node /usr/lib/node_modules/openclaw/dist/index.js gateway --port 18789`
- memory slot in config: `cortex-memory-bridge`
- WhatsApp linked: yes

### Staged candidate
- path: `/root/clawd/_staging/openclaw-2026.4.5`
- source version: `2026.4.5`
- WhatsApp thread-binding port applied: yes
- bundled-plugin postinstall run: yes
- staged CLI runnable: yes
- staged patch behavior validated in isolated harness: yes

### Proven staging artifacts
- staged tree:
  - `/root/clawd/_staging/openclaw-2026.4.5`
- patch script:
  - `/root/clawd/scripts/patch-openclaw-whatsapp-thread-bound-sessions-2026-4-5-staging.mjs`
- staging patch diff:
  - `/root/clawd/patches/openclaw-whatsapp-thread-bound-sessions-2026.4.5-staging.patch`
- staging validation notes:
  - `/root/clawd/docs/OPENCLAW_2026_4_5_WHATSAPP_THREAD_BINDING_STAGING_PORT.md`

## Promotion philosophy

This is **not** a blind `openclaw update`.

This is a controlled replacement of the live OpenClaw package tree with the already-tested staged `2026.4.5` tree.

Why:
- live install contains important local behavior that had to be ported
- the port is already baked into the staged tree
- upstream package install/update by itself would not preserve that behavior automatically

## Do not repeat this mistake

When preparing packaged staging trees, do **not** use:

```bash
npm install --omit=dev --ignore-scripts
```

Reason:
- OpenClaw uses `scripts/postinstall-bundled-plugins.mjs` to install lazy-loaded bundled extension runtime deps
- skipping scripts leaves the build partially broken

## Promotion gate

Only promote if all are true:

- staged tree exists at `/root/clawd/_staging/openclaw-2026.4.5`
- staged bundle includes patched `dist/pi-embedded-DWASRjxE.js`
- staged CLI `status --deep` succeeded previously
- isolated harness passed against the exact staged helper block
- current live gateway is healthy before cutover

## Preflight checks (read-only)

Run these first:

```bash
openclaw gateway status
openclaw status --deep
node /root/clawd/scripts/test-openclaw-2026-4-5-thread-binding-fallback.mjs
```

Expected:
- gateway healthy
- WhatsApp linked
- memory slot still `cortex-memory-bridge`
- harness returns `status: ok`

## Backup plan

Create timestamped backups before touching the live tree.

### Backup commands

```bash
ts=$(date +%Y%m%d_%H%M%S)
mkdir -p /root/clawd/_backups/openclaw-promotion-${ts}
cp -a /usr/lib/node_modules/openclaw /root/clawd/_backups/openclaw-promotion-${ts}/openclaw-live
cp -a /root/.openclaw /root/clawd/_backups/openclaw-promotion-${ts}/openclaw-state
cp -a ~/.config/systemd/user/openclaw-gateway.service /root/clawd/_backups/openclaw-promotion-${ts}/openclaw-gateway.service 2>/dev/null || true
printf '%s\n' "$ts" > /root/clawd/_backups/openclaw-promotion-${ts}/TIMESTAMP
```

### Backup success criteria
- live package tree copied
- state tree copied
- service file copied when present

## Promotion procedure

### Step 1 — stop the live gateway service

```bash
openclaw gateway stop
```

Check:

```bash
openclaw gateway status
```

Expected:
- service stopped
- no active listener on `127.0.0.1:18789`

### Step 2 — replace the live package tree with the staged tree

Use the staged tree as the promotion source.

```bash
rsync -a --delete /root/clawd/_staging/openclaw-2026.4.5/ /usr/lib/node_modules/openclaw/
```

Why `rsync --delete`:
- ensures old hashed bundles from `2026.3.28` do not linger and confuse runtime loading

### Step 3 — start the live gateway service again

```bash
openclaw gateway start
```

### Step 4 — immediate service health checks

```bash
openclaw gateway status
openclaw status --deep
```

Expected:
- gateway running
- RPC probe ok
- WhatsApp still linked
- plugin memory slot still `cortex-memory-bridge`
- no new fatal config-read/module-load errors

## Post-promotion validation

### A) Basic runtime validation

```bash
openclaw gateway status
openclaw status --deep
openclaw memory search --query "Mailchimp canonical status"
```

Expected:
- gateway healthy
- WhatsApp linked
- memory search still functions through the configured bridge/runtime path

### B) Must-preserve behavior validation

This is the critical behavioral check that motivated the port.

Use a controlled WhatsApp conversation and trigger a thread-bound subagent spawn from the live runtime.

Success criteria:
- `sessions_spawn(thread=true, mode="session")` no longer fails with:
  - `thread=true is unavailable because no channel plugin registered subagent_spawning hooks.`
- the new session binds to the **current conversation**
- no duplicate thread/conversation misbinding

Recommended validation style:
- use a low-risk test agent/task
- perform from an active conversation already tied to your WhatsApp account
- verify only one new bound session is created

### C) Regression spot checks

Check these still look normal:

```bash
openclaw logs --limit 120
openclaw status --deep
```

Look for absence of:
- config invalid/module not found
- plugin registry load failures
- channel plugin load failures
- session-binding errors on startup

## Rollback plan

If any post-promotion validation fails:

### Step 1 — stop gateway

```bash
openclaw gateway stop
```

### Step 2 — restore previous package tree

```bash
latest=$(ls -dt /root/clawd/_backups/openclaw-promotion-*/ | head -n1)
rsync -a --delete "$latest/openclaw-live/" /usr/lib/node_modules/openclaw/
```

### Step 3 — optionally restore state if promotion mutated state unexpectedly

Normally avoid state rollback unless necessary, but if needed:

```bash
latest=$(ls -dt /root/clawd/_backups/openclaw-promotion-*/ | head -n1)
rsync -a --delete "$latest/openclaw-state/" /root/.openclaw/
```

### Step 4 — restart and verify

```bash
openclaw gateway start
openclaw gateway status
openclaw status --deep
```

## Stop conditions

### Promotion success
All of these must be true:
- gateway healthy
- WhatsApp linked
- memory slot still `cortex-memory-bridge`
- no runtime/module load failures
- thread-bound subagent/current-conversation behavior works in live validation

### Promotion failure
Any of these is enough to stop and roll back:
- gateway fails to start
- config invalid/module load failure appears
- WhatsApp unlinked or channel load breaks
- memory runtime/bridge stops functioning
- thread-bound subagent spawn regresses

## Minimal command list for the actual cutover

```bash
ts=$(date +%Y%m%d_%H%M%S)
mkdir -p /root/clawd/_backups/openclaw-promotion-${ts}
cp -a /usr/lib/node_modules/openclaw /root/clawd/_backups/openclaw-promotion-${ts}/openclaw-live
cp -a /root/.openclaw /root/clawd/_backups/openclaw-promotion-${ts}/openclaw-state
cp -a ~/.config/systemd/user/openclaw-gateway.service /root/clawd/_backups/openclaw-promotion-${ts}/openclaw-gateway.service 2>/dev/null || true
openclaw gateway stop
rsync -a --delete /root/clawd/_staging/openclaw-2026.4.5/ /usr/lib/node_modules/openclaw/
openclaw gateway start
openclaw gateway status
openclaw status --deep
```

## Recommendation

This promotion plan is ready to execute, but because it changes the live install and service, it should still be run as a deliberate cutover with explicit approval at execution time.
