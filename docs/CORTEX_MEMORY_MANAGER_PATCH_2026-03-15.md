# Cortex Memory Manager Patch — 2026-03-15

## What changed
Implemented Option B by wiring OpenClaw's internal `MemorySearchManager` seam to a Cortex-backed manager when the active memory slot is `cortex-memory-bridge`.

## Why
`openclaw memory search` does not use plugin `memory_search` tools. It resolves through the internal search-manager path, which only supported builtin/qmd backends. That meant the Cortex bridge could be loaded while CLI memory search still returned empty or disabled results.

## Implementation
- Added workspace manager shim:
  - `plugins/cortex-memory-bridge/manager.mjs`
- Patched installed OpenClaw resolver:
  - `/usr/lib/node_modules/openclaw/dist/search-manager-CR5cykjp.js`
- Behavior:
  - if `plugins.slots.memory == "cortex-memory-bridge"`, OpenClaw now loads the Cortex manager shim
  - shim queries Cortex over HTTP and applies query-time reranking

## Reranking policy
- Boost curated memories
- Penalize noisy WhatsApp fragments on short/vague queries
- Penalize common noise patterns:
  - completion hype
  - bare/source links
  - INFO/log lines
  - hash blobs
  - generic affirmations
- Allow more natural completion-history surfacing for explicitly historical/completion queries

## Validation
Normal CLI path now returns Cortex-backed results.
Examples:
- `openclaw memory search --query "side quests"`
  - returns curated anti-drift memories first
- `openclaw memory search --query "stop drifting"`
  - returns curated anti-drift rules first
- `openclaw memory search --query "What should be prioritized?"`
  - returns curated priority memories first

## Caveat
The installed OpenClaw distribution file under `/usr/lib/node_modules/openclaw/dist/` was patched live. The workspace contains the shim and this documentation, but the distro patch itself is host-local and should be reapplied after package upgrades unless upstreamed properly.
