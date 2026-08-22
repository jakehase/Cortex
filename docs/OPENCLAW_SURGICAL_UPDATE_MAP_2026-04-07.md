# OpenClaw surgical update map — 2026-04-07

## Grounding

User intent:
- do **not** blindly upgrade OpenClaw if that overwrites important local runtime changes
- prefer updating only the bits that genuinely improve the install while preserving critical local behavior

Live machine observed:
- installed OpenClaw: `2026.3.28`
- available upstream: `2026.4.5`
- install mode: `pnpm`
- memory slot: `cortex-memory-bridge`
- gateway healthy
- WhatsApp linked

## Reply anchor / remembered plan

The correct framing is **surgical enhancement**, not wholesale replacement.

Reason:
- this machine has host-local OpenClaw runtime modifications
- at least one of them is definitely live inside `/usr/lib/node_modules/openclaw/dist`
- a normal package update will replace hashed bundle files and erase those modifications

## What is definitely customized locally

### 1) WhatsApp thread-bound subagent session patch

Observed live evidence:
- patched file: `/usr/lib/node_modules/openclaw/dist/auth-profiles-B5ypC5S-.js`
- backup exists: `/usr/lib/node_modules/openclaw/dist/auth-profiles-B5ypC5S-.js.bak-whatsapp-thread-bindings-20260404141059`
- workspace reapply assets:
  - `/root/clawd/scripts/patch-openclaw-whatsapp-thread-bound-sessions.mjs`
  - `/root/clawd/patches/openclaw-whatsapp-thread-bound-sessions.patch`
  - `/root/clawd/docs/WHATSAPP_THREAD_BOUND_SESSIONS_ENABLEMENT_2026-04-04.md`

What the patch does:
- keeps legacy `subagent_spawning` hook path if present
- if absent, falls back to **current-conversation binding** using:
  - `resolveThreadBindingSpawnPolicy(...)`
  - `getSessionBindingService().bind(...)`
- this is what makes `sessions_spawn(thread=true, mode="session")` work for WhatsApp on this box

### 2) Older Cortex memory-manager/search-manager workaround

Documented evidence:
- `/root/clawd/docs/CORTEX_MEMORY_MANAGER_PATCH_2026-03-15.md`
- workspace shim:
  - `/root/clawd/plugins/cortex-memory-bridge/manager.mjs`

Important nuance:
- the old doc references a live patch target that no longer exists in this exact form:
  - `search-manager-CR5cykjp.js`
- current OpenClaw already has explicit memory runtime seams such as:
  - `registerMemoryRuntime(...)`
  - `getMemoryRuntime()`
  - `getActiveMemorySearchManager(...)`
- so the **old dist-patch strategy appears partially superseded by newer runtime architecture**

Conclusion:
- the WhatsApp patch is definitely still a must-preserve local behavior
- the old memory-manager dist patch is **likely obsolete or at least much less central** on the current/newer architecture, but still needs validation after any staged upgrade

## Current live hot-zone files

### Current 2026.3.28
- `auth-profiles-B5ypC5S-.js`
- `memory-DyCqaz7n.js`
- `memory-runtime-Cv9oKNiM.js`
- `memory-state-CKh9RZhV.js`
- `memory-search-C7gfehPk.js`
- `memory-search-IBGDxxv8.js`

### Upstream 2026.4.5 relevant files
- `auth-profiles-gRFfbuWd.js`
- `loader-BkajlJCF.js`
- `memory-Cswkof4v.js`
- `memory-runtime-C_LZob9g.js`
- `memory-state-BWbQIcQt.js`
- `commands-acp-CSbNjPSN.js`
- `pi-embedded-DWASRjxE.js`
- `session-binding-service-1Qw5xtDF.js`
- `thread-bindings-policy-C5NA_pbl.js`

## Key architectural observation

The upstream 2026.4.5 build has **split and reshuffled** the hot zones:
- hashed bundle names changed
- some logic that previously lived in giant aggregate bundles now appears in more clearly separated runtime files

That means:
- the existing WhatsApp patch script is **not reusable as-is** after upgrade because it hardcodes:
  - exact hashed filename
  - exact string block matches
- a surgical upgrade must port behavior, not blindly replay the old patch script

## High-risk overlap areas

### A) MUST preserve: WhatsApp thread-bound subagent spawn behavior

Why high risk:
- upstream 2026.4.5 still contains the failure path:
  - `thread=true is unavailable because no channel plugin registered subagent_spawning hooks.`
- that means the needed fallback behavior does **not** appear to be fully upstream in the relevant subagent path

Likely upstream target to patch/port:
- `pi-embedded-DWASRjxE.js`

Why:
- this file contains the subagent spawn/thread binding logic and the exact legacy error string
- the ACP path already has richer current-conversation binding handling in `commands-acp-CSbNjPSN.js`
- the unresolved issue is the **subagent spawn path**, not basic ACP binding

Supporting shared surfaces that must stay compatible:
- `session-binding-service-1Qw5xtDF.js`
- `thread-bindings-policy-C5NA_pbl.js`

### B) MEDIUM risk: ACP / session-binding semantics drift

Files:
- `commands-acp-CSbNjPSN.js`
- `session-binding-service-1Qw5xtDF.js`
- `thread-bindings-policy-C5NA_pbl.js`

Why:
- even if we only patch `pi-embedded-*`, upstream behavior changes in these shared files could break assumptions about:
  - placement = `current`
  - capability checks
  - policy checks
  - existing-binding conflict handling

### C) LOW-to-MEDIUM risk: memory runtime path

Files:
- `loader-BkajlJCF.js`
- `memory-runtime-C_LZob9g.js`
- `memory-state-BWbQIcQt.js`
- `memory-Cswkof4v.js`

Why lower risk:
- upstream now clearly has first-class memory runtime plumbing
- local config already uses `plugins.slots.memory = "cortex-memory-bridge"`
- this suggests 2026.4.5 may actually reduce the need for old search-manager hacks instead of increasing it

What still needs proof:
- after staging 2026.4.5, confirm the Cortex bridge works without carrying an old dist patch forward

## File-by-file surgical classification

### Must preserve / port
- `auth-profiles-B5ypC5S-.js` local behavior
  - **not** the literal file itself
  - preserve the **behavior** by porting the WhatsApp thread-binding fallback into upstream 2026.4.5 subagent path
- workspace assets to keep:
  - `scripts/patch-openclaw-whatsapp-thread-bound-sessions.mjs`
  - `patches/openclaw-whatsapp-thread-bound-sessions.patch`
  - docs for rollback/provenance

### Safe to stage/test from upstream first
- `loader-BkajlJCF.js`
- `memory-runtime-C_LZob9g.js`
- `memory-state-BWbQIcQt.js`
- `memory-Cswkof4v.js`
- `memory-search-*`

Reason:
- these look like upstream improvements that likely help rather than conflict, but they still need staged validation with `cortex-memory-bridge`

### Likely obsolete / probably should not be re-carried blindly
- the old direct `search-manager-*` patch strategy from March 15

Reason:
- current/upstream code now exposes proper memory runtime seams
- the exact old patch target file is no longer the same artifact on the current build line
- reapplying an old search-manager dist patch blindly would likely be wrong

### Highest-risk live-overwrite surfaces
- `auth-profiles-*`
- `pi-embedded-*`
- `commands-acp-*`
- `session-binding-service-*`
- `thread-bindings-policy-*`

Reason:
- these are where the WhatsApp/session-binding behavior lives now or is likely to have been redistributed

## Recommended staged plan

### Phase 1 — no live mutation
1. Keep current live install untouched
2. Preserve fresh backups of:
   - `/usr/lib/node_modules/openclaw`
   - `/root/.openclaw`
3. Build a staging copy of 2026.4.5 without replacing the production install

### Phase 2 — surgical port in staging
1. Identify the exact upstream subagent thread-binding path in `pi-embedded-DWASRjxE.js`
2. Port the **current-conversation binding fallback** behavior from the old WhatsApp patch
3. Do **not** blindly replay the old hashed-file patch script
4. Treat ACP/session-binding helper files as read-only unless the port proves they must also change

### Phase 3 — memory runtime validation in staging
1. Enable `cortex-memory-bridge`
2. Verify plugin memory slot activation still works
3. Verify retrieval/store behavior
4. If memory works cleanly, retire the old idea of carrying the March search-manager patch forward

### Phase 4 — promote only if these checks pass
Promotion gate:
- gateway healthy
- WhatsApp linked
- `thread=true` current-conversation/subagent behavior works on WhatsApp
- Cortex memory slot still works
- no regression in reply/completion integrity plugins

## Explicit recommendation

**Do not run `openclaw update` directly on the live install yet.**

Best next action:
- build a **staging 2026.4.5 port plan for the WhatsApp thread-binding patch**, because that is the one clearly live, clearly valuable local behavior that upstream still appears not to cover in the needed subagent path

## Condensed supervisor truth

- current install is customized: **yes**
- blind package update safe: **no**
- must-preserve local behavior: **WhatsApp thread-bound subagent/current-conversation binding**
- old memory-manager dist patch likely still required: **unclear / probably not as-is**
- best enhancement-first strategy: **stage 2026.4.5, port WhatsApp behavior, validate memory runtime, then promote**
