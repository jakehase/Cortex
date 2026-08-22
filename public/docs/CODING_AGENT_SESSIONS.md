# Coding agent sessions

## Core idea

Not all code work should run in the main chat session.

Use coding sessions when you need:
- isolation
- persistence
- longer-running work
- a dedicated coding harness

## Session types

### Main session
Use for:
- lightweight inspection
- quick edits
- high-context conversation

### Isolated session
Use for:
- focused background work
- tasks that may take longer
- subagent delegation

### ACP / coding session
Use for:
- Codex/Claude Code/Gemini style coding flows
- persistent thread-bound coding contexts
- one-shot or ongoing code work

## Practical guidance

Prefer:
- main session for small work
- isolated/coding sessions for heavier work
- explicit session boundaries when tool exposure or persistence matters

## Why this matters

Coding work often needs different:
- tools
- timeouts
- isolation
- persistence
- ergonomics

That is why execution context should be treated as a first-class design choice.
