# Transport-only OpenClaw Hardening (2026-02-12)

## Goal
Move toward strict boundary:
- **OpenClaw = transport only** (delivery plumbing, channel I/O)
- **Cortex = brain/policy/render intent** (HUD/presentation contract ownership, orchestration, policy)

Keep WhatsApp delivery stable while reducing OpenClaw logic surface.

---

## 1) Migration checklist (risk-minimized)

### NOW (safe, immediate)
1. Freeze current OpenClaw HUD patch files in workspace (`patches/openclaw-hud/*`) and keep a reproducible reapply script.
2. Remove OpenClaw synthetic HUD fallback (always-on and `_activated` synthesis) so presentation text is sourced from Cortex contract (`_hud`/`hud`) only.
3. Preserve delivery safety exceptions in OpenClaw (`HEARTBEAT_OK`, `NO_REPLY`) to avoid transport regressions.
4. Verify patched deliver bundles compile (`node --check`) and run WhatsApp normalization smoke test.
5. Document explicit ownership boundary and rollback commands.

### NEXT (low-medium risk)
1. Define a **versioned Cortex response contract** for channel presentation fields:
   - `presentation.hud.text`
   - `presentation.channel_overrides.whatsapp.footer`
   - `presentation.tokens` (heartbeat/silent)
2. Move token constants (`HEARTBEAT_OK`, `NO_REPLY`) to Cortex config and pass to OpenClaw as config-driven transport behavior.
3. Replace direct dist-file patching with one of:
   - maintained OpenClaw plugin hook, or
   - pinned post-install patch automation with checksum validation.
4. Add integration tests that run against live message send pipeline (dry-run first, then controlled canary).

### LATER (structural)
1. Eliminate all OpenClaw presentation logic; transport only forwards Cortex-rendered text/media payload.
2. Upstream/replace remaining OpenClaw customizations into Cortex-side routers/middleware.
3. Keep OpenClaw upgrades unblocked by removing hash-specific `deliver-*.js` patch dependencies.
4. Introduce contract compatibility gates in CI (Cortex contract version vs OpenClaw transport version).

---

## 2) Inventory of current OpenClaw custom patches

### A. Runtime OpenClaw dist patch (active)
**Location:** `/usr/local/lib/node_modules/openclaw/dist/deliver-*.js` (4 hashed bundles)

Custom behavior currently present:
- HUD append path in delivery normalization
- Token exceptions for `HEARTBEAT_OK` and `NO_REPLY`

Classification:
- **KEEP (temporary):** token exception guardrails in transport until Cortex contract fully handles them.
- **REMOVE NOW:** synthetic HUD fallback generation from `_activated`/always-on defaults in OpenClaw.
- **REPLACE-IN-CORTEX:** all HUD content rendering decisions and composition rules.

### B. Patch source-of-truth copy
**Location:** `/root/.openclaw/workspace/patches/openclaw-hud/`
- `deliver-DBa33Idu.js`
- `deliver-D6MIjM7L.js`
- `deliver-CuG3GpE3.js`
- `deliver-4EFV-ple.js`
- `reapply_patch.sh`

Classification:
- **KEEP:** as rollback-capable staging artifacts until upstream/plugin migration complete.
- **LATER REMOVE:** once patchless transport path is implemented.

### C. Local validation tooling
**Location:** `/root/.openclaw/workspace/hud_enforcement_whatsapp_test.mjs`

Classification:
- **KEEP:** useful regression guard for WhatsApp normalization behavior.

### D. Bridge helpers (non-delivery patch, still custom OpenClaw surface)
**Location:** `/root/.openclaw/workspace/bridge/openclaw_bridge.py`, `openclaw_bridge_http.py`

Classification:
- **NEXT REPLACE-IN-CORTEX:** move invocation/policy routing ownership fully into Cortex API layer, keep OpenClaw as execution transport only.

---

## 3) Phase-1 implementation completed now

### Change applied
In all OpenClaw deliver bundles (runtime + workspace patch copies), `buildFallbackHud(...)` now returns empty string.

**Result:**
- OpenClaw no longer invents/synthesizes HUD text.
- HUD/presentation text only appears when Cortex provides `_hud`/`hud` contract fields.
- Transport exceptions remain intact (`HEARTBEAT_OK`, `NO_REPLY`) to preserve stable delivery semantics.

### Boundary after this phase
- **OpenClaw owns:**
  - message send mechanics
  - chunking and channel transport constraints
  - silent/heartbeat token safety handling
- **Cortex owns:**
  - whether HUD exists
  - HUD content, formatting intent, activation narrative
  - policy/orchestration decisions behind presentation

---

## 4) Verification commands

```bash
# 1) Syntax check patched OpenClaw deliver bundles
for f in /usr/local/lib/node_modules/openclaw/dist/deliver-*.js; do node --check "$f"; done

# 2) Run WhatsApp normalization smoke test
node /root/.openclaw/workspace/hud_enforcement_whatsapp_test.mjs

# 3) Confirm behavior from test output expectations:
# - sample with _hud => HUD appended
# - sample with only _activated => no synthetic HUD appended
# - HEARTBEAT_OK preserved
# - NO_REPLY remains silent

# 4) Reapply known-good patch set if needed
bash /root/.openclaw/workspace/patches/openclaw-hud/reapply_patch.sh
```

---

## 5) Rollback plan

### Fast rollback (to previous workspace patch behavior)
If you have previous copies/backups of `patches/openclaw-hud/deliver-*.js`, restore them then:

```bash
bash /root/.openclaw/workspace/patches/openclaw-hud/reapply_patch.sh
```

### Conservative rollback via package reinstall
If runtime transport is suspected broken:

```bash
npm i -g openclaw@latest
# then re-run verification commands
```

### Operational safety note
Do **not** restart/alter WhatsApp channel config during this phase. This change is payload normalization-only and was validated via local normalization tests to avoid delivery interruption.

---

## Change summary (executed)
- Updated all 4 runtime `deliver-*.js` bundles under `/usr/local/lib/node_modules/openclaw/dist/` to disable synthetic HUD fallback generation.
- Updated corresponding workspace patch copies under `patches/openclaw-hud/`.
- Reapplied patch set with `reapply_patch.sh`.
- Re-ran `hud_enforcement_whatsapp_test.mjs`; output confirms transport stability and Cortex-owned HUD behavior.
