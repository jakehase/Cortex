# cortex-memory-bridge

Workspace memory plugin routing OpenClaw `memory_search` into Cortex HTTP search.

Status: enabled.

Notes:
- `memory_search` maps to Cortex `/knowledge/search`.
- Query-time routing now classifies searches into `fast`, `reconcile`, or `investigate` modes.
- The bridge performs conflict-aware reranking: recency, explicitness, source quality, corroboration, and stale/superseded penalties are folded into the final score.
- `memory_search` responses now include `memoryMode`, `queryType`, `resolvedFacts`, and `conflicts` metadata to support higher-trust memory answers.
- When memory is clean-but-empty after noise suppression, the response includes a `fallback` hint telling the caller to use workspace/filesystem or live tools instead of over-trusting empty memory.
- `memory_get` is intentionally a stub because Cortex does not currently expose OpenClaw's file-snippet read contract.
- Historical/completion-style queries are allowed to surface completion chatter more naturally; short vague queries are biased toward curated memory.
