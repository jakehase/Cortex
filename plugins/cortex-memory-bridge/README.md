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
- Search defaults to the reserved `cortex-local/default` compatibility scope. Non-default tenant/workspace scopes fail closed unless `scopeHmacSecret` (or `writeToken`) is configured; the bridge uses the server's canonical tenant/workspace HMAC contract and forwards optional agent, user, channel, and session context separately.
- Assurance-gated write-through and Codec continuity remain opt-in for existing deployments. Write-through first obtains `/nexus/assurance/receipt`, then supplies the bound receipt to `/nexus/commit`; output counts as stored only after Cortex confirms the scoped durable write.
- When lifecycle persistence is enabled, bursts are held in a bounded backpressure queue backed by an atomic, permission-restricted spool under `stateDir`. Failed acknowledgments retain the output for caller-visible and restart recovery instead of marking the lifecycle key complete.
