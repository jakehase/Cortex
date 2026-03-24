# WhatsApp fix audit — 2026-03-14

## Scope

This is the first-pass implementation audit derived from the WhatsApp export.
The raw mined event set lives at:

- `/root/recovery/cortex-rebuild-2026-03-14/corpus/fix-audit/fix-events.jsonl`
- `/root/recovery/cortex-rebuild-2026-03-14/corpus/fix-audit/fix-events.md`

Raw event counts are intentionally broad; many are progress updates, not distinct fixes.
This document tracks the **deduped high-value implementation items** and their current status.

## First-pass current status

### 1. Current OpenClaw/Codex auth preserved
- Status: **YES**
- Evidence:
  - current auth store preserved under `/root/recovery/cortex-rebuild-2026-03-14/auth-preserve/`
  - `openclaw models status` previously confirmed `openai-codex:default` auth OK

### 2. Host OpenClaw service managed by systemd and auto-restart enabled
- Status: **YES**
- Evidence:
  - `openclaw-gateway.service` enabled/running
  - `Restart=always`
  - root `Linger=yes`

### 3. WhatsApp channel currently connected
- Status: **YES**
- Evidence:
  - active direct chat in current session
  - current credentials preserved in live OpenClaw state + safety backups

### 4. CT101 safety backups/snapshots in place before rebuild work
- Status: **YES**
- Evidence:
  - official OpenClaw backup(s)
  - CT101 environment snapshot
  - transcript-based recovery artifacts

### 5. Legacy Cortex runtime exactly as before
- Status: **NO / BROKEN**
- Notes:
  - old `gladys-clawdbot` stack is fragile/orphaned
  - old raw L7/L22 stores missing
  - missing project/script paths and prior dependency issues remain in the legacy stack

### 6. Clean staged Cortex runtime brought up separately
- Status: **YES (staged, not cut over)**
- Evidence:
  - Docker image built: `cortex-rebuild-stage:minimal-20260314`
  - smoke container reachable on `http://127.0.0.1:18888`
  - `/health`, `/kernel/status`, `/librarian/status`, `/knowledge/status`, `/l22/status`, `/oracle/status` respond successfully

### 7. Staged L7/L22 memory endpoints work
- Status: **YES (staged)**
- Evidence:
  - `librarian/status` reports active
  - `l22/status` reports active
  - staged store/search smoke test succeeded and incremented memory count

### 8. Cortex reconnected to the live OpenClaw path
- Status: **NOT YET**
- Notes:
  - staged runtime is healthy
  - live cutover/bridge wiring has not been switched yet
  - must preserve current Codex auth while reconnecting

### 9. Observability auto-recover / cron fixes still present
- Status: **YES**
- Evidence:
  - root cron contains observability auto-recover entries
  - compose/autorecover paths still present

### 10. Formbricks healthy
- Status: **NO**
- Notes:
  - currently restarting / unhealthy from prior audit

### 11. groq-proxy healthy
- Status: **REMOVED INTENTIONALLY**
- Notes:
  - removed on user request
  - was an unhealthy standalone container with no active compose/systemd wiring

### 12. Home Assistant / Gladys integration historically configured
- Status: **HISTORICALLY YES, LIVE REVALIDATION STILL NEEDED**
- Evidence:
  - legacy transcript evidence shows Home Assistant configured at `10.0.0.7:8123`
  - connected via MCP / `ha-mcp`
  - token and SSH access were documented in old `/root/clawd/` memory files
- Notes:
  - this proves the old fix/setup existed
  - I have not yet revalidated live connectivity from the current CT101 runtime path
  - I am intentionally not replaying or exposing historic secret values from transcripts in chat

### 13. Legacy `cortex.service` / permanent service fix still present
- Status: **NO**
- Evidence:
  - no current `/etc/systemd/system/cortex.service`
  - no current host `/root/cortex_server/run.sh`
- Notes:
  - instead, we now have a **new staged Cortex runtime** that is healthy on an alternate port
  - if we want a permanent service again, it should be recreated from the staged rebuild path rather than relying on the old broken legacy layout

### 14. PMHNP main site
- Status: **YES**
- Evidence:
  - `https://pmhnpbilling.com` responds successfully

### 15. PMHNP intake flow
- Status: **NO / REGRESSED**
- Evidence:
  - `https://intake.pmhnpbilling.com` returns 502
  - `formbricks` is crash-looping (3400+ restarts)

## What this means

The important previous fixes around:

- current auth
- host OpenClaw stability
- WhatsApp connectivity
- safety backups
- a clean staged Cortex runtime

are in good shape.

The items that still need active work are:

- live Cortex reconnection
- hybrid memory rebuild into L7/L22
- repair or retire the fragile legacy `gladys-clawdbot` path
- unrelated unhealthy side services (`formbricks`, `groq-proxy`)

## Next audit pass

Next pass should dedupe the WhatsApp fix archive into concrete buckets such as:

- auth / identity
- OpenClaw service management
- WhatsApp channel behavior
- Home Assistant / Gladys integration
- PMHNP / billing project infra
- Proxmox / host infra
- Cortex / L7 / L22 / Oracle behavior
- observability / backups / cron

Then verify each bucket against current CT101 state.
