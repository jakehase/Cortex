# Capability reality-checking

## Core idea

Before proposing or implementing a new upgrade, Cortex can try to check whether the capability already exists in some form.

## Questions it should ask

- is it already implemented?
- is it live?
- is it verified?
- is it blocked?
- are we rediscovering something we already built?

## Why this matters

Complex systems waste a lot of time by:
- re-implementing existing features
- mislabeling partial features as missing
- forgetting blockers that were already found
- contradicting prior claims about what exists

## Cortex approach

Use a capability registry and preflight process to distinguish between:
- coded
- live
- verified
- blocked

## Distinctive claim

This is unusual because it treats upgrade planning as something that also needs evidence, not just enthusiasm.

## See also
- [Public docs index](INDEX.md)
- [Novelty index](NOVELTY_INDEX.md)
- [Architecture visual](ARCHITECTURE_VISUAL.md)

