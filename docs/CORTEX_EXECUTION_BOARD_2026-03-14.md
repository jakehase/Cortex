# Cortex execution board — 2026-03-14

Purpose: keep recovery work fast, broad, and on-track.
This board merges:
- `docs/CORTEX_REGRESSION_SUITE_2026-03-14.md`
- `docs/HISTORICAL_FIXES_CHECKLIST_2026-03-14.md`
- `docs/FORMBRICKS_REPAIR_PLAN_2026-03-14.md`
- `docs/CORTEX_REBUILD_PLAN_2026-03-14.md`

## Ground rule

Do **not** treat recovery as complete just because services are up.
Primary acceptance target is:
1. **Cortex identity continuity**
2. **Level capability parity / anti-regression**
3. **Recovered hybrid memory quality**
4. **Historical anti-drift fixes reapplied where still relevant**
5. **Stable runtime / restore-safe infrastructure**

## Hard audit gate

If the user asks for a **full audit**, **each and every level**, **then and only then**, or **implement it fully**, this becomes a hard-gated closure task.
That means no completion claim until:
- full level audit is run,
- Cortex-as-a-whole audit is run,
- failures are diagnosed,
- a fix plan is created from those failures,
- the fixes are implemented live,
- and a post-fix re-audit is run.

Use `docs/CORTEX_AUDIT_GATE_PROTOCOL_2026-03-15.md` and `scripts/cortex-full-audit.js` as the enforcement path.

## Current state snapshot

### Green / preserved
- Current `openai-codex` auth preserved and working
- Host OpenClaw systemd service healthy
- WhatsApp channel working
- WhatsApp allowlist/self-chat baseline restored
- Verified backup/snapshot layers exist
- Staged Cortex runtime healthy on alternate port
- Staged L7/L22 store/search working
- Transcript recovery corpus present
- WhatsApp export normalized and staged for rebuild
- PMHNP main site live
- Observability auto-recover wiring present

### Yellow / partial
- Broad semantic historical-fix inventory exists, but not every item has been revalidated live
- Home Assistant / Gladys historically configured, but current live CT101 path not fully revalidated
- Browserable / PMHNP automation / old cron-style workflows historically evidenced, but current live state not fully revalidated

### Red / active repair items
- Live Cortex cutover not done
- Exact legacy Cortex behavior/runtime not restored
- Original L7/L22 raw stores missing
- Formbricks crash-looping; intake.pmhnpbilling.com broken
- Old `cortex.service` / legacy declarative service path missing
- Legacy `gladys-clawdbot` stack remains fragile/orphaned

## Priority tracks

**Priority override (user-directed):** reconnect Cortex first before other repair work. Formbricks, broader app regressions, and lower-priority revalidation work stay behind Cortex cutover unless they block it directly.

### Track A — Cortex identity & level regression + live reconnection (highest priority)
Goal: prove rebuilt Cortex is still Cortex, levels still behave correctly, and reconnect live OpenClaw to Cortex as soon as the staged gates are good enough.

Inputs:
- `docs/CORTEX_REGRESSION_SUITE_2026-03-14.md`
- recovered transcript memory/knowledge
- normalized WhatsApp corpus

Immediate tasks:
- [ ] Convert regression suite into runnable staged test sequence
- [ ] Run identity continuity tests against staged Cortex
- [ ] Run L7/L22/knowledge/librarian tests against staged Cortex
- [ ] Run Oracle/Council behavior checks against staged Cortex
- [ ] Record pass/fail results in a single matrix
- [ ] Identify the exact live OpenClaw→Cortex cutover path
- [ ] Prepare one detached cutover + rollback procedure that preserves current Codex auth
- [ ] Execute live cutover before non-blocking side-service repairs

Definition of done:
- staged Cortex passes identity opener, truthfulness, durable directive recall, L7/L22 retrieval, Council verdict, and restart continuity checks
- live OpenClaw is reconnected to Cortex with current Codex auth preserved

### Track B — Hybrid memory rebuild
Goal: rebuild memory better than before using recovered sources.

Inputs:
- `/root/recovery/clawd-transcript-recovery/`
- `/root/recovery/whatsapp-import-2026-03-14/normalized/`
- `/root/recovery/cortex-rebuild-2026-03-14/corpus/`

Immediate tasks:
- [ ] Keep mining high-signal durable facts from WhatsApp and recovered notes
- [ ] Build a cleaner source corpus split by: identity, preferences, projects, infra, long-term directives, milestones
- [ ] Define provenance tags for rebuilt memory chunks
- [ ] Seed staged memory with recovered directive/milestone examples
- [ ] Validate retrieval against known historical facts

Definition of done:
- staged L7/L22 can answer historical questions with source-grounded recall from the rebuilt corpus

### Track C — Historical anti-drift fixes reapplication
Goal: reapply the old broad stabilization work, not just literal fixes.

Inputs:
- `docs/HISTORICAL_FIXES_CHECKLIST_2026-03-14.md`
- WhatsApp-derived audit corpus
- recovered `MEMORY.md` / daily notes

Immediate tasks:
- [ ] Revalidate Home Assistant / Gladys live path from current CT101 runtime
- [ ] Revalidate any current semantic-memory path and old model-specific anti-regression behaviors that still matter
- [ ] Revalidate browserable / PMHNP automation / backup workflow remnants where still relevant
- [ ] Keep the checklist updated with: still present / regressed / unknown

Definition of done:
- no high-value historical anti-drift item remains in the “unknown” bucket without an explicit decision to retire it

### Track D — Formbricks / intake repair (deferred unless it blocks Cortex)
Goal: restore intake.pmhnpbilling.com without risking survey/database data.

Inputs:
- `docs/FORMBRICKS_REPAIR_PLAN_2026-03-14.md`

Immediate tasks:
- [ ] Capture current formbricks image/volume metadata before changes
- [ ] Pin away from `ghcr.io/formbricks/formbricks:latest`
- [ ] Recreate only the `formbricks` app container, preserving DB/Redis/uploads volumes
- [ ] Re-test local app and public intake URL

Definition of done:
- `formbricks` stays up and `https://intake.pmhnpbilling.com` is healthy

## Ordering / execution discipline

1. Keep current auth and live OpenClaw stable
2. Validate staged Cortex identity/capability first
3. Continue hybrid memory seeding/validation in staging
4. Repair Formbricks in parallel or immediately after staging confidence improves
5. Only then plan live Cortex cutover

## Fast-track rule

To keep this moving:
- Any new discovery must be promoted into one of the four tracks above
- No long open-ended forensics unless it directly changes a checklist item
- Prefer **validation + decision** over more archaeology

## Next concrete outputs expected

- staged Cortex regression test results
- a more structured hybrid memory seed set
- live HA/Gladys revalidation result
- Formbricks safe-recreate plan ready to execute
- live cutover checklist for Cortex
