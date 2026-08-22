# Extensibility model

This stack has several extension concepts. They should feel like one system, not scattered lore.

## Skills

Skills are task-specific operating instructions.

Use them when a task needs:
- domain-specific procedure
- specialized workflow guidance
- guardrails for a known task type

## Plugins

Plugins provide runtime/tool capabilities.

Examples:
- browser bridge
- memory bridge
- route gate
- reliability plugins

## Cortex routes

Routes are reasoning/tool-selection policy.

They decide things like:
- browse first or not
- memory first or not
- which cognitive path should handle a task
- what kind of evidence is needed

## OpenClaw sessions

Sessions are execution contexts.

They determine:
- what tools are exposed
- what state persists
- whether work is isolated
- how results flow back

## The clean mental model

- **Skills** = how to do a task well
- **Plugins** = what runtime capabilities exist
- **Routes** = how cognition chooses a path
- **Sessions** = where execution actually happens

That model should stay stable even as the system grows.
