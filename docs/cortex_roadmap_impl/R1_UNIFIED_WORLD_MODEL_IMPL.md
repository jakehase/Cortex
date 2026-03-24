# R1 Unified World Model v0 — Phase A Implementation Slice

## Scope delivered
- `services/world_state/schema_v1.json` — world-state schema with provenance + causal edges.
- `services/world_state/update_pipeline.py` — deterministic event merge + causal edge builder.
- `services/world_state/snapshot_manager.py` — snapshot/rollback controls.
- `services/world_state/causal_edges.jsonl` — seed artifact.
- `config/cortex_runtime/r1_world_model_v0.json` — merge/snapshot policy contract.

## Core behavior
1. Canonically order events by timestamp + event_id.
2. Merge into state using deterministic last-event-wins assignment.
3. Persist provenance entries for each update.
4. Build causal edges from explicit causes or temporal same-entity fallback.
5. Save/restore snapshots for safe rollback.

## Run
```bash
python3 services/world_state/update_pipeline.py
python3 scripts/probes/probe_r1_world_model.py
```

## Current limits
- Schema validation is structural (no jsonschema runtime dependency wired yet).
- Causal confidence scoring is not implemented yet.
