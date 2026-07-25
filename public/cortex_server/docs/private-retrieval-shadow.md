# Selective private-retrieval shadow observer

Status: **default-on, observe-only**.

This observer measures whether selected private-fact questions have a useful principal-scoped retrieval pack available. It does not pass candidates, snippets, scores, or decisions into the answer path. Shadow evidence cannot promote retrieval into answer generation; promotion requires a separate reviewed decision and controlled causal evidence.

## Request flow

1. `cortex-route-gate` sends the complete routing query to Nexus and, when available, a separate `private_retrieval_shadow_query` containing only the latest user turn.
2. Nexus authenticates the full memory principal and derives the adaptive state path from that authenticated scope.
3. The classifier selects open-ended private fact, prior-decision, preference, project-state, and operational-setting lookups. It rejects action/generation requests, external volatile lookups, unanchored general questions, oversized input, and sensitive-secret lookup terms.
4. Eligible requests schedule a bounded background call to `librarian.robust_search()` using only the authenticated tenant and storage-workspace scope.
5. The observer simulates a maximum 3-item / 600-estimated-token pack by default, then discards all candidate content.
6. Nexus returns only an opaque observation ID and non-content flags in `routing_markers.private_retrieval_shadow`. The route gate does not render this marker into model context and strips it from last-good route caches.
7. On run completion, the route gate writes a content-free baseline record that can be joined to the server observation by the opaque ID. It explicitly records `qualityCompared=false`; successful retrieval or baseline completion is not treated as utility evidence.

## Privacy and isolation invariants

- Full authenticated principal isolation remains authoritative: credential, tenant, workspace, agent, user, channel, and continuity session boundaries are unchanged.
- Raw prompts, retrieved text, snippets, candidate scores, source IDs, metadata bodies, outputs, and exception messages are never persisted in shadow telemetry.
- Candidate content is never returned by Nexus, added to `reasoning`, rendered by the route gate, or exposed to the model.
- State is principal-scoped, record-capped, lock-protected, atomically replaced, and stored with mode `0600` in a mode-`0700` directory.
- Retrieval and persistence failures fail open and do not block routing or answer generation.
- Queue capacity and per-principal rate limits bound resource use; observed latency is checked against a configurable shadow SLA without delaying the answer path.

## Controls

Server environment controls (defaults shown):

```text
CORTEX_PRIVATE_RETRIEVAL_SHADOW_ENABLED=true
CORTEX_PRIVATE_RETRIEVAL_SHADOW_KILL_SWITCH=false
CORTEX_PRIVATE_RETRIEVAL_SHADOW_WORKERS=2
CORTEX_PRIVATE_RETRIEVAL_SHADOW_MAX_PENDING=32
CORTEX_PRIVATE_RETRIEVAL_SHADOW_MAX_RECORDS=1000
CORTEX_PRIVATE_RETRIEVAL_SHADOW_RATE_LIMIT=30
CORTEX_PRIVATE_RETRIEVAL_SHADOW_RATE_WINDOW_SECONDS=60
CORTEX_PRIVATE_RETRIEVAL_SHADOW_RESULT_COUNT=8
CORTEX_PRIVATE_RETRIEVAL_SHADOW_PACK_ITEMS=3
CORTEX_PRIVATE_RETRIEVAL_SHADOW_PACK_TOKENS=600
CORTEX_PRIVATE_RETRIEVAL_SHADOW_LATENCY_LIMIT_MS=1500
```

Route-gate controls:

```text
privateRetrievalShadowTelemetryEnabled=true
privateRetrievalShadowTelemetryMaxRecords=1000
```

The immediate stop control is `CORTEX_PRIVATE_RETRIEVAL_SHADOW_KILL_SWITCH=true`. Disabling route-gate telemetry does not enable answer-path use; it only stops the baseline join records.

## Inspection

Authenticated callers may read content-free server status at:

```text
GET /nexus/private-retrieval-shadow/status
```

The response is scoped to the authenticated principal. It reports counters and the latest content-free operational record only.

## Promotion boundary

No shadow metric by itself authorizes answer-path use. Candidate availability, successful retrieval, latency, or correlation with a successful baseline run are not causal quality evidence. Any future promotion needs a separate approved contract with identical-item treatment/control evaluation, privacy review, rollback, canarying, and explicit answer-influence tests.
