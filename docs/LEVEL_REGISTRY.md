# Cortex Canonical Level Registry

Source of truth: cortex_server/modules/level_registry.py

This file defines the canonical mapping for:
- level number
- level name
- canonical status endpoint
- aliases

## Runtime verification
curl -s http://10.0.0.52:8888/meta_conductor/endpoint_map
curl -s http://10.0.0.52:8888/nexus/registry

## Notes
- In SAFE_MODE, L9 canonical status maps to /meta_conductor/status.
- If SAFE_MODE is disabled, L9 canonical status maps to /architect/status.
