# Truth layers

Use this file when a campaign or benchmark has multiple valid but different status layers.

## Common layered statuses

### Orchestration healthy
Meaning:
- launcher, worker, supervisor, and merge path worked well enough to complete their own contract

Does not imply:
- threshold pass
- parity completion
- full clone

### Mechanical green
Meaning:
- the orchestrator execution path came back green

Does not imply:
- scale proof
- threshold pass
- product completion

### Scale proven
Meaning:
- shard inventory and observed concurrency supported the requested scale claim for that run shape

Does not imply:
- threshold pass
- parity completion

### Threshold pass
Meaning:
- the scored benchmark conditions passed

Does not imply:
- product parity
- full clone

### Parity for scope
Meaning:
- the declared scoped parity target is satisfied

Does not imply:
- full clone

### Full clone
Meaning:
- the strict highest requested parity target is complete

Requires:
- explicit parity evidence
- full surface coverage
- no remaining blocker against the full-clone request

## Safe phrasing

- "Orchestration passed, requested outcome still blocked."
- "Mechanically green, threshold red."
- "Benchmark passed, parity claim not evaluated here."
- "Supervisor green, full-clone ceiling still red."

## Unsafe phrasing

- "Done" when only internal orchestration passed
- "Passed" when only baseline-ready exists
- "Full" when only parity-for-scope was proven
