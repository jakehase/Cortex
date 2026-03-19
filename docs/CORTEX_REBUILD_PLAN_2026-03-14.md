# Cortex rebuild + reconnect plan — 2026-03-14

## Goal

Rebuild a stronger Cortex memory system while preserving:

- current working CT101/OpenClaw host state
- current `openai-codex` OAuth auth
- recovered Clawd/Cortex memory artifacts

And restore a working Cortex/PMHNP integration path.

## Principles

- Do not overwrite current working OpenClaw auth/config blindly.
- Treat old L7/L22 raw stores as lost unless newly found from off-box backups.
- Build from a hybrid source corpus instead of pretending the original DBs still exist.
- Separate **runtime repair** from **memory reconstruction**.
- Make the rebuilt system exportable/back-up-able in human-readable form.

## Phase 0 — Preservation

Already done:

- CT101 safety backup(s)
- CT101 environment snapshot
- transcript-based recovery under `/root/recovery/clawd-transcript-recovery`
- public Cortex repo cloned at `/root/recovery/gh-Cortex`

Still preserve during rebuild:

- current `~/.openclaw/agents/main/agent/auth-profiles.json`
- current WhatsApp/OpenClaw credentials
- `gladys-clawdbot` snapshot artifacts

## Phase 1 — Source harvest for new memory corpus

### Sources already available

1. Recovered transcript files:
   - `MEMORY.md`
   - `memory/*.md`
   - `knowledge/*`
2. Legacy OpenClaw / Clawdbot session transcripts
3. Public Cortex code/docs repo
4. Current OpenClaw workspace/docs/memory

### Sources requested from user

5. Full WhatsApp conversation export
6. Any off-box VM102/Gladys archives / private backup repo access

## Phase 2 — Runtime repair (Cortex/PMHNP)

Repair the old Cortex-adjacent stack non-destructively:

1. Reconstruct missing project/runtime files as needed
2. Repair Python dependencies for `cortex_server`
3. Confirm persistence paths we will use for the rebuilt system
4. Bring up and verify:
   - Cortex service port
   - PMHNP operational HTTP port
   - cloudflared/tunnel path if still desired
5. Keep current host OpenClaw stable while testing

## Phase 3 — L7/L22 rebuild (state only, not architecture rewrite)

### L7 rebuild

- rebuild semantic/vector memory from hybrid corpus
- attach provenance metadata for each chunk:
  - `whatsapp`
  - `recovered-memory-md`
  - `recovered-knowledge-md`
  - `session-transcript`
  - `repo-doc`
- dedupe repeated chat/export text
- separate durable facts from transient chatter

### L22 rebuild

- reconstruct higher-order graph / semantic relationships
- focus on durable entities:
  - people
  - projects
  - devices
  - preferences
  - credentials/services (metadata only, not secret values)
  - routines
  - decisions
  - unresolved threads

## Phase 4 — Validation

Validate rebuilt memory against known truths:

- ask known-fact recall questions
- verify important preferences and project facts
- compare against recovered `MEMORY.md` / `memory/*.md`
- confirm relationship graph / project continuity

## Phase 5 — Hardening so this does not happen again

Backups must include all of:

- vector store
- graph DB
- JSONL/ledger/checkpoint files
- human-readable markdown memory/knowledge
- config/runtime metadata

Also add:

- restore verification checklist
- export of memory summaries in human-readable form
- periodic integrity check of persistence paths

## What to do in parallel

### I can do now

- continue runtime repair prep for Cortex/PMHNP
- organize recovered memory corpus
- design ingest/rebuild pipeline

### Waiting on user

- WhatsApp export delivery
- any access to private/off-box backup sources

## WhatsApp export requirements

Preferred:

- plain text export of the direct chat with **no media**
- preserve timestamps and speaker labels
- larger is fine; zip is fine

Nice to have:

- date range notes if partial
- any older exports from previous phones/backups

## Success definition

1. Cortex runtime is healthy again
2. current OpenClaw/Codex auth still works
3. a new L7/L22 memory layer is populated from hybrid sources
4. memory recall quality is at least as good as before for important facts
5. the rebuilt memory is actually backup-safe and restorable
