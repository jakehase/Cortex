# cortex-memory-bridge

Workspace memory plugin routing OpenClaw `memory_search` into Cortex HTTP search.

Status: enabled.

Notes:
- `memory_search` maps to Cortex `/knowledge/search`.
- Query-time reranking boosts curated memories and penalizes noisy WhatsApp fragments on vague queries.
- `memory_get` is intentionally a stub because Cortex does not currently expose OpenClaw's file-snippet read contract.
- Historical/completion-style queries are allowed to surface completion chatter more naturally; short vague queries are biased toward curated memory.
