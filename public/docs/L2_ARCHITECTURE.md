# L2 architecture

## Short version

L2 is the Cortex browser/discovery layer.

It should not be thought of as just another generic browser tool.
It is the layer responsible for:
- discovery
- targeted browse
- current-information grounding
- feeding later reasoning stages

## Intended role

When a task depends on fresh web information, L2 should be the first meaningful step.

Examples:
- checking a live X post
- looking up current product docs
- discovering relevant sources before synthesis

## Two practical modes

### Query-only mode
Used for discovery/search.

Current implementation target:
- `/browser/search`

### URL-targeted mode
Used when the system already has a destination and wants direct extraction/browse behavior.

Current implementation target:
- `/browser/browse`

## Why this matters

If these modes are collapsed carelessly, the result is brittle behavior and confusing failures.
A clean split between discovery and targeted browse is part of making L2 reliable.

## L2 in the larger stack

L2 is not the whole answer.
It is the first stage in a broader chain:
- L2 discover/browse
- deeper retrieval/contextualization
- validation
- synthesis

That is why L2 should be documented as a layer, not just a plugin.

## See also
- [Public docs index](INDEX.md)
- [Novelty index](NOVELTY_INDEX.md)
- [Architecture visual](ARCHITECTURE_VISUAL.md)

