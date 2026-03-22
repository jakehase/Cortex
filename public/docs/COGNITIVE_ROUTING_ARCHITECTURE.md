# Cognitive routing architecture

## Core idea

Cortex should not be understood as a flat planner that simply picks a tool.
It is trying to route tasks into different **cognitive paths**.

Examples of different paths:
- browse-first
- memory-first
- validation-heavy
- synthesis-heavy
- creativity-governed
- capability-reality-checked

## Why this matters

A flat agent loop often treats every task as the same shape.
Cortex is trying to distinguish between task types before execution.

That means the system can ask:
- does this need fresh evidence?
- does this need historical memory?
- does this need contradiction handling?
- does this need validation before answering?
- does this need a creativity governor?

## Architectural consequence

Routing becomes part of cognition, not just a helper function around tools.

## Distinctive claim

The point is not merely to choose a tool.
The point is to choose a **mode of reasoning** that then determines how tools, memory, validation, and synthesis should be used.

## See also
- [Public docs index](INDEX.md)
- [Novelty index](NOVELTY_INDEX.md)
- [Architecture visual](ARCHITECTURE_VISUAL.md)

