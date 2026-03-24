# VM102 Semantic Activation — 2026-03-15

## What changed
Patched VM102 Cortex Oracle chat path so relevant prompts auto-dispatch into the native fabrics:

- **prediction_fabric** for forecast/simulation/outcome/risk prompts
- **context_fabric** for memory/priority/blocker/architecture/drift prompts

## Activation behavior
### Context-class prompts
Examples:
- "What should be prioritized right now?"
- "What are the current blockers?"
- "What do you remember about ...?"
- "Stop drifting"

Behavior:
- routed to `context_fabric`
- mode selected semantically (`durable_first`, `historical`, or `balanced`)
- Oracle returns a direct answer from the context fabric result set

### Prediction-class prompts
Examples:
- "What are the likely outcomes if ...?"
- "Simulate ..."
- "Best case / worst case"
- "Forecast ..."

Behavior:
- routed to `prediction_fabric`
- mode selected semantically:
  - normal forecast → `fast` or `balanced`
  - explicit "deep/full/thorough" forecast → `deep`
- deep forecasts return async job acceptance instead of blocking chat

## Production intent
This makes semantic activation automatic in the live Oracle chat path. The fabrics no longer need to be invoked manually by endpoint for normal use.

## Caveat
Semantic activation is targeted, not universal. Only prompts that look like context-memory or forecast-simulation requests are auto-routed; other prompts still use the normal Oracle path.
