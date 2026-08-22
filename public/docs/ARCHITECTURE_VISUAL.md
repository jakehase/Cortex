# Architecture visual

## High-level stack

```text
User / Channel / Session
          |
          v
     OpenClaw runtime
  (channels, sessions, tools,
   cron, subagents, delivery)
          |
          v
        Cortex
 (routing, memory, browser,
  validation, synthesis)
```

## Research chain

```text
Task arrives
   |
   v
[Discover / Browse]  <- L2
   |
   v
[Retrieve / Contextualize]
   |
   v
[Validate]
   |
   v
[Synthesize]
```

## Memory chain

```text
Query arrives
   |
   +--> Fast recall
   |
   +--> Reconcile
   |
   +--> Investigate
   |
   +--> Clean-but-empty
```

## Control-plane idea

```text
Proposed improvement
   |
   v
Capability reality-check
   |
   +--> implemented?
   +--> live?
   +--> verified?
   +--> blocked?
   |
   v
Decide whether to fix, verify, or build
```

## Key distinction

OpenClaw determines what is executable in the current runtime.
Cortex determines what kind of cognition should be used.
