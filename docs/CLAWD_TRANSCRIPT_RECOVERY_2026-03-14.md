# Clawd transcript recovery — 2026-03-14

## What was recovered

By parsing legacy session JSONL files under:

- `/opt/clawdbot/data/agents/main/sessions/`

I was able to recover full or near-full contents of several old `/root/clawd/` memory/knowledge files from:

- `read` tool results
- `write` tool call payloads
- `memory_search` snippets

Recovered output root:

- `/root/recovery/clawd-transcript-recovery`

Primary recovered files:

- `/root/recovery/clawd-transcript-recovery/recovered-files/MEMORY.md`
- `/root/recovery/clawd-transcript-recovery/recovered-files/memory/2026-01-27.md`
- `/root/recovery/clawd-transcript-recovery/recovered-files/memory/2026-01-29.md`
- `/root/recovery/clawd-transcript-recovery/recovered-files/memory/2026-02-01.md`
- `/root/recovery/clawd-transcript-recovery/recovered-files/knowledge/projects/money-making-agent.md`
- `/root/recovery/clawd-transcript-recovery/recovered-files/knowledge/projects/pmhnp-billing-site.md`

Additional files recovered from tool-call payloads:

- `/root/recovery/clawd-transcript-recovery/recovered-from-toolcalls/knowledge/projects/money-agent-50-validation.md`
- `/root/recovery/clawd-transcript-recovery/recovered-from-toolcalls/knowledge/resources/security-reference.md`
- plus alternate versions of `MEMORY.md` and `memory/2026-02-01.md`

Supporting snippet sets:

- `/root/recovery/clawd-transcript-recovery/search-snippets/MEMORY.md.snippets.txt`
- `/root/recovery/clawd-transcript-recovery/search-snippets/memory/2026-01-27.md.snippets.txt`
- `/root/recovery/clawd-transcript-recovery/search-snippets/memory/2026-01-29.md.snippets.txt`
- `/root/recovery/clawd-transcript-recovery/search-snippets/memory/2026-02-01.md.snippets.txt`

## Important limitation

This is a recovery of **human-readable memory/knowledge files** from transcript evidence.
It is **not** the raw lost Cortex L7/L22 semantic/vector/graph backend.

No surviving on-disk copies were found for the documented old Cortex memory stores such as:

- `chroma_db`
- `cortex_graph.db`
- JSONL ledgers/checkpoints
- Mnemosyne/neuro-symbolic store files

## Why this still matters

The old session archive proves that `/root/clawd/` used these durable knowledge paths:

- `/root/clawd/MEMORY.md`
- `/root/clawd/memory/`
- `/root/clawd/knowledge/`
- `/root/clawd/backups/`

and enough of that content can now be reconstructed from transcripts to seed a partial restore.

## Suggested next use

- Review recovered files for sensitive secrets before wider reuse
- Use them as seed material to rebuild long-term memory in the current system
- Keep searching for off-box or private-backup copies of the true L7/L22 backend
