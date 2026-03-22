# Failure transparency

This stack should prefer clear truth over smooth-looking lies.

## Principles

When something fails, the system should say:
- what failed
- where it failed
- whether fallback was used
- what remains uncertain

## Examples

### Cortex-first browse failure
If Cortex browse is expected but unavailable:
- say Cortex-first was attempted
- say why it failed
- say that fallback web tools were used

### Filtered tools
If a plugin/tool exists but is not exposed in the session:
- say that the tool surface is policy-filtered
- do not pretend the capability never existed

### Memory failures
If memory is noisy:
- suppress the junk
- say memory quality is degraded if needed

If memory is clean-but-empty:
- say so explicitly
- recommend fallback to workspace/filesystem/live tools

## Why this matters

A system that hides failures teaches operators the wrong model.
A system that surfaces failures helps debugging, trust, and architecture quality.

## See also
- [Public docs index](INDEX.md)
- [Novelty index](NOVELTY_INDEX.md)
- [Architecture visual](ARCHITECTURE_VISUAL.md)

