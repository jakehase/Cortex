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
- Every request sends one complete tenant/workspace/agent/user/channel/session principal. Configure `scopeCredentialId` and its credential-specific `scopeHmacSecret`; the write token is deliberately not accepted as a scope-signing key. Cortex rejects incomplete principals and credentials whose allowed-scope list does not contain the exact requested principal.
- `memory_search` binds principal identity from OpenClaw's trusted tool-factory context, never from model-controlled arguments or configured global user/session fallbacks. Searches without a complete session/user/channel/agent context fail closed.
- Codec continuity is enabled by default and requires `sessionIdentityHmacSecret` shared with `cortex-route-gate`, producing one canonical opaque session key on writes and live reads. Explicitly provision one secret outside the repository and configure its exact value in both plugin entries; neither plugin has a built-in secret. Configure the same tenant/workspace and credential-specific `scopeCredentialId`/`scopeHmacSecret` in the route gate so orchestration sends the same complete signed principal as memory access. Missing or blank session-secret values fail plugin registration before lifecycle hooks and spool replay start. Assurance-gated write-through remains separately configurable and counts output as stored only after Cortex confirms the scoped durable write.
- Disabling both persistence modes is explicit: lifecycle persistence reports failure and retains buffered output instead of acknowledging or deleting it.
- When lifecycle persistence is enabled, bursts are held in a bounded backpressure queue backed by an atomic, permission-restricted spool under `stateDir`. Failed acknowledgments retain the output for caller-visible and restart recovery instead of marking the lifecycle key complete.
