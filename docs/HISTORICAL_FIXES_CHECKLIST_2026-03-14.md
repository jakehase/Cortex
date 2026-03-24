# Historical fixes / anti-drift checklist — 2026-03-14

Scope: deduped historical items mined from WhatsApp-derived audit data, recovered notes, and transcript artifacts.

Primary sources:
- `/root/.openclaw/workspace/docs/WHATSAPP_FIX_AUDIT_2026-03-14.md`
- `/root/recovery/cortex-rebuild-2026-03-14/corpus/fix-audit/fix-events.{md,jsonl}`
- `/root/recovery/clawd-transcript-recovery/recovered-files/`
- `/root/recovery/clawd-transcript-recovery/search-snippets/`
- selected legacy session evidence under `/opt/clawdbot/data/agents/main/sessions/`

Important framing:
- This goes beyond explicit “fix” language.
- Included here are items that were once broken and later described as working, items that improved capability/stability, and anti-drift guardrails that were intentionally put in place.
- Status buckets reflect **current 2026-03-14 evidence**, not historical truth.

---

## 1) Still present

### OpenClaw / service management / auth / guardrails
- [x] **Current OpenClaw auth preserved and still valid**
  - Current evidence: `openclaw models status` previously confirmed `openai-codex:default` OAuth OK; auth preserve copy exists under `/root/recovery/cortex-rebuild-2026-03-14/auth-preserve/`.
- [x] **Host OpenClaw managed by systemd with auto-restart**
  - Historical intent: keep assistant/gateway up reliably.
  - Current evidence: `openclaw-gateway.service` enabled/running with `Restart=always`; user linger enabled.
- [x] **Gateway not publicly exposed; loopback/local posture preserved**
  - Historical evidence: Jan 27 transcript explicitly marked gateway `bind: loopback`, `mode: local`, not exposed on Shodan.
  - Current evidence: Mar 14 audit still describes host OpenClaw service as healthy and local.
- [x] **Observability auto-recover remains in place**
  - Historical intent: self-healing observability stack via cron/compose.
  - Current evidence: Mar 14 audit says root cron still contains observability auto-recover entries and compose/autorecover paths remain.
- [x] **Safety-backup-before-risky-change pattern is present again**
  - Historical pattern: backups before config edits / restores.
  - Current evidence: fresh verified OpenClaw backup, CT101 snapshot, and guarded restore script requiring validation before execution.
- [x] **Restore flow now has anti-regression checks**
  - Current evidence: `scripts/openclaw-safe-restore.sh` validates archive shape, creates fresh backup, runs doctor, verifies runtime/RPC, auto-rolls back on failure.

### WhatsApp behavior / messaging controls
- [x] **WhatsApp channel is currently connected**
  - Historical evidence: WhatsApp was the live control channel and used for cron/status reporting.
  - Current evidence: Mar 14 audit marks WhatsApp connected.
- [x] **Personal-number allowlist baseline restored**
  - Historical evidence: recovered `MEMORY.md` says “WhatsApp: Allowlist only (+17855410986)” and “use allowlist mode for all messaging channels.”
  - Current evidence: live config corrected to `dmPolicy: "allowlist"`, `allowFrom: ["+17855410986"]`, `selfChatMode: true`.
- [x] **Pairing-request spam regression was corrected and pairing store cleared**
  - Current evidence: pending pairing requests removed from `/root/.openclaw/credentials/whatsapp-pairing.json`; gateway restarted cleanly; pairing store empty.
- [x] **WhatsApp as report/notification surface remains a known design pattern**
  - Historical evidence: heartbeat/hot-lead workflow and SEO monitor reported to WhatsApp.
  - Current evidence: channel still available; no evidence that outbound reporting path itself is broken after the DM-policy repair.

### Backups / snapshots / recovery assets
- [x] **Multiple recovery layers now exist**
  - Current evidence: official backup(s), CT101 snapshot, transcript-recovery artifacts, WhatsApp normalization output, staged rebuild workspace.
- [x] **Transcript-based recovery of memory/knowledge succeeded**
  - Current evidence: recovered files in `/root/recovery/clawd-transcript-recovery/` include `MEMORY.md`, daily notes, and project docs.
- [x] **WhatsApp export normalized into a reusable rebuild corpus**
  - Current evidence: 16,427 parsed messages and derived fix-audit corpus exist under `/root/recovery/whatsapp-import-2026-03-14/` and `/root/recovery/cortex-rebuild-2026-03-14/`.

### Cortex / memory / capability improvements that are currently real
- [x] **Clean staged Cortex runtime exists and is healthy**
  - Current evidence: `cortex-rebuild-stage:minimal-20260314` built; smoke container healthy at `http://127.0.0.1:18888`; `/health`, `/kernel/status`, `/librarian/status`, `/knowledge/status`, `/l22/status`, `/oracle/status` all respond.
- [x] **Staged L7/L22 store-search flow works**
  - Current evidence: staged store/search smoke test succeeded and increased memory count.
- [x] **Historical semantic-memory improvements are preserved as knowledge, if not live in legacy runtime**
  - Historical evidence: Jan 31 sessions show native semantic search with Gemini embeddings was enabled, indexing completed, and recall started working after initial empty results.
  - Current carry-forward evidence: transcript artifacts preserve that implementation history and acceptance criteria.

### Home Assistant / Gladys / PMHNP / browserable items that are clearly still present
- [x] **PMHNP main marketing site still works**
  - Historical evidence: pmhnpbilling.com built, SEO improved, sitemap/schema added, GitHub Pages + DNS completed.
  - Current evidence: Mar 14 audit says `https://pmhnpbilling.com` responds successfully.
- [x] **Historical Home Assistant topology is well recovered in notes**
  - Historical evidence: HA via MCP at `10.0.0.7:8123`; SSH access established; ESPHome config editing noted.
  - Current evidence: transcript recovery preserves these details for revalidation/rebuild.
- [x] **Historical browserable deployment details are recovered**
  - Historical evidence: self-hosted Browserable installed at `/root/clawd/browserable/`, services and logs documented.
  - Current evidence: recovered notes preserve exact paths/ports/logs for reuse.
- [x] **Historical PMHNP/Formbricks/Cloudflare implementation details are substantially recovered**
  - Historical evidence: Formbricks setup, migration workaround, tunnel routing, public URL correction, intake domain wiring all captured in fix-events/session transcripts.
  - Current evidence: enough detail exists to reconstruct/compare against present state.

---

## 2) Regressed / missing

### Cortex identity / capability / service continuity
- [ ] **Legacy Cortex runtime is not intact**
  - Current evidence: Mar 14 audit says exact old runtime is “NO / BROKEN.”
  - Details: orphaned `gladys-clawdbot`, missing project/script paths, dependency failures, missing old service layout.
- [ ] **Live Cortex cutover/reconnection is still not done**
  - Current evidence: staged runtime healthy, but live OpenClaw path not yet reconnected.
- [ ] **Historical L7/L22 memory stores are missing**
  - Current evidence: no surviving Chroma L7/L22 store or Mnemosyne/knowledge graph payload found in host, snapshot, container layers, or public repo.
- [ ] **Old Cortex anti-drift/cognitive behavior is not yet restored**
  - Current evidence: user clarified the real acceptance target is identity continuity, level capability parity, memory recall quality, and prior “cognitive behavior”; this remains unmet.
- [ ] **Legacy host `cortex.service` / permanent service fix is absent**
  - Current evidence: no current `/etc/systemd/system/cortex.service`; no host `/root/cortex_server/run.sh` as a clean declarative service path.
- [ ] **Legacy PMHNP/Cortex sidecar stack is partly broken**
  - Current evidence: `pmhnp-operational-http` references missing startup script path; `cortex_server` crashes on missing `psutil`; `OPENROUTER_API_KEY` warning noted.

### WhatsApp behavior regressions that had to be corrected
- [ ] **WhatsApp DM-policy drift had occurred**
  - Historical baseline: allowlist-only + self-chat posture.
  - Regression evidence: live config had drifted to `dmPolicy: "pairing"` with no allowlist/self-chat, causing pairing prompts to owner contacts.
  - Note: this regression is now corrected, but it belongs in the checklist as a known historical anti-drift failure mode.

### Home Assistant / Gladys / PMHNP / browserable / Formbricks
- [ ] **PMHNP intake flow is currently broken**
  - Historical evidence: intake route and public URL were made to work via Cloudflare tunnel + Formbricks URL fix.
  - Current evidence: `https://intake.pmhnpbilling.com` returns 502.
- [ ] **Formbricks is currently unhealthy / crash-looping**
  - Historical evidence: Formbricks was eventually brought up, migrations worked via official compose path, survey flow published, public URL fixed.
  - Current evidence: container restarting thousands of times; intake broken.
- [ ] **Gladys-era runtime is an orphaned, non-declarative legacy container**
  - Historical evidence: Gladys/clawdbot keypaths and SSH identity were part of the working stack.
  - Current evidence: current container depends on ad hoc PM2/manual/container-local state and is not represented by a clean current compose definition.
- [ ] **Historical Home Assistant live integration has not been revalidated from current CT101 path**
  - Historical evidence: HA MCP connectivity, direct token access, automations inspection, ESPHome SSH edits.
  - Current evidence: only historical proof; no current Mar 14 live revalidation yet.
- [ ] **Browserable current health is not established and may not be live**
  - Historical evidence: installed and partly fixed (API URLs updated, single-user mode disabled).
  - Current evidence: only recovered notes; no current runtime verification in Mar 14 audit.

### Other infrastructure drift
- [ ] **`groq-proxy` was unhealthy and removed**
  - Historical significance: stray sidecar with restart loop and stored API key in env.
  - Current evidence: intentionally removed; if any functionality depended on it, that dependency would now need explicit replacement.

---

## 3) Unknown / needs revalidation

These are historically important fixes, improvements, or guardrails that are strongly evidenced in notes/transcripts but not yet proven present or absent on the current 2026-03-14 system.

### Cortex / OpenClaw cognitive behavior / anti-drift
- [?] **Native semantic search remains live in the current runtime path**
  - Historical evidence: Jan 31 sessions show gateway patched/restarted, Gemini embeddings indexing completed, and semantic recall began returning results.
  - Current unknown: this may have been lost in later migrations/restores; needs live `memory_search`/index status verification.
- [?] **Model-specific anti-regression tweaks around Kimi/Gemini session behavior remain applicable or preserved**
  - Historical evidence: Jan 31 sessions show a Kimi ordering-conflict problem, then a compat/config fix after which WhatsApp + Kimi resumed working.
  - Current unknown: present runtime is Codex-centric; exact old workaround may be obsolete, absent, or superseded.
- [?] **Oracle / prompt-bundling level capabilities exist beyond notes-only recovery**
  - Historical evidence: recovered `MEMORY.md` lists `oracle - Prompt bundling` as an installed capability.
  - Current unknown: no Mar 14 runtime proof that this layer is live or functionally equivalent.
- [?] **Sub-agent/cron anti-drift workflows still exist in current OpenClaw state**
  - Historical evidence: content-creator, competitor-intel, SEO-index-check cron jobs, heartbeat workflows, and manual subagent fallbacks are visible in Jan 31 sessions.
  - Current unknown: current live `.openclaw` may or may not still include these jobs after restore drift.

### WhatsApp / notification workflows
- [?] **Hot-lead detection and WhatsApp alerting still function end-to-end**
  - Historical evidence: heartbeat instructions recorded “email webhook ACTIVE”, lead detection working, WhatsApp notifications fixed/manual mode.
  - Current unknown: not revalidated during Mar 14 audit.
- [?] **WhatsApp login / QR relink flow is still documented and operational**
  - Historical evidence: recovered `MEMORY.md` references `whatsapp_login`; pairing storage and pending requests existed historically.
  - Current unknown: not tested beyond current connected session.

### Backups / observability / security guardrails
- [?] **Historical weekly security-audit workflow still exists in runnable form**
  - Historical evidence: `security-audit.sh`, `SECURITY_HARDENING.md`, and weekly audit guidance appear in recovered memory.
  - Current unknown: script/path presence and current usefulness not checked on Mar 14.
- [?] **Historical GitHub backup push workflow still works off-box**
  - Historical evidence: backup repo `jakehase/clawdbot-backup`, SSH key `~/.ssh/github_backup`, and backups path `/root/clawd/backups/` are documented.
  - Current unknown: Mar 14 notes say current host/container no longer have the old GitHub access key/CLI needed to query private backup state directly.
- [?] **Observability stack functionality, not just files/cron entries, is healthy**
  - Current evidence only proves auto-recover wiring exists; does not prove dashboards/collectors are currently green.

### Home Assistant / Gladys
- [?] **Home Assistant MCP connectivity still works from the current runtime path**
  - Historical evidence: token-based connection, state reads, automation inspection, and direct access all worked at points in late Jan.
  - Current unknown: must re-test from current CT101/OpenClaw context.
- [?] **ESPHome/voice-assistant changes still exist on HA side**
  - Historical evidence: wake word enabled, voice commands added, backup created, compile/upload still needed.
  - Current unknown: no current HA-side verification.
- [?] **Cozyla automation state/device-connectivity issues may still matter**
  - Historical evidence: automation logic was described as correct, but device reporting/connectivity was flaky/stale.
  - Current unknown: not rechecked.

### PMHNP / browserable / Formbricks
- [?] **Browserable could likely be reconstructed, but current deployment state is unclear**
  - Historical evidence: install path, service ports, and prior fixes captured.
  - Current unknown: no current service/process/HTTP proof.
- [?] **PMHNP billing automation app still exists in usable form**
  - Historical evidence: 2,075-line TypeScript app with encryption/audit logging/RBAC compiled and ran on port 3000.
  - Current unknown: not checked in present filesystem/runtime.
- [?] **SEO/website cron automations still exist**
  - Historical evidence: content creator and SEO index check cron jobs were added and configured to report back.
  - Current unknown: not verified in current live OpenClaw state.

---

## High-value anti-drift takeaways

These are the historical themes that should be treated as acceptance criteria for any rebuild/reconnect:

1. **Preserve identity, not just uptime**
   - The important regression is not merely “service down”; it is Cortex identity drift, loss of level behavior, and degraded recall/cognition.

2. **Prefer declarative, restart-safe service layouts**
   - Historical failures cluster around ad hoc container-local state, missing scripts, and orphaned services.
   - Current staged Cortex path is healthier than reviving the old fragile layout blindly.

3. **Messaging channels need explicit guardrails**
   - Historical baseline clearly favored allowlist-only messaging and local bind.
   - The WhatsApp pairing drift incident shows these controls must be continuously enforced.

4. **Backups must be validated, not assumed**
   - Mar 14 recovery work showed a logged “creating” backup was not actually a completed restore source.
   - Verified backups + dry-run restore validation are now essential anti-regression controls.

5. **Recovered transcripts are now part of the memory substrate**
   - Even without old L7/L22 vector stores, transcripts preserve a substantial amount of system behavior, capability history, and prior fixes.

6. **Separate “historically existed” from “currently revalidated”**
   - Home Assistant, Browserable, PMHNP automation, and old Oracle/Cortex-level behaviors all have strong historical evidence, but many still need live confirmation.
