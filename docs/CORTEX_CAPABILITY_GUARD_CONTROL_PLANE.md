# Cortex Control-Plane Capability Guard (2026-03-01)

## Purpose
Prevent duplicate "next improvements" recommendations by forcing a capability reality-check in `/nexus/orchestrate` for tuning/improvement prompts.

## Deployment target
- Container: `cortex-brain`
- File: `/app/cortex_server/routers/nexus.py`

## Behavior added
- Detects tuning/introspection prompts (e.g., "what else should we tune", "don't we already have...").
- Runs `capability_reality_check` classification with statuses:
  - `already_implemented`
  - `partially_implemented`
  - `missing`
- **Domain-wide inventory sources**:
  - discovered docs (when mounted)
  - embedded broad fallback capability seed
  - historical claim ledger (`/opt/clawdbot/state/nexus_capability_claims.jsonl`)
- **Contradiction-resolution against historical claims**:
  - detects status flips for same proposal across turns
  - downgrades risky `already_implemented -> missing` flips to `partially_implemented` and flags review
- Emits results in `/nexus/orchestrate` response:
  - `capability_reality_check`
  - `routing_markers.capability_reality_required`
  - `routing_markers.capability_reality_performed`
  - `routing_markers.historical_contradictions_detected`
  - contract flags:
    - `capability_reality_check_gate`
    - `capability_reality_check_required`
    - `capability_reality_check_performed`
    - `capability_reality_scope`

## Safety / fallback
- Uses docs inventory when available.
- Falls back to embedded capability inventory if docs are not mounted in runtime.

## Validation snippet
```bash
curl -s 'http://10.0.0.52:8888/nexus/orchestrate?query=what%20else%20should%20we%20tune%20for%20reliability%3F' | jq '.capability_reality_check,.routing_markers,.contract'
```

## Backups
- `/app/cortex_server/routers/nexus.py.bak-20260301T001951Z-capability-guard`
- `/app/cortex_server/routers/nexus.py.bak-20260301T002133Z-capability-guard2`
- `/app/cortex_server/routers/nexus.py.bak-20260301T002224Z-capability-guard3`
