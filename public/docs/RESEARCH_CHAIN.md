# Research chain

## Core idea

Good research behavior is not just:
- search once
- quote result
- answer immediately

The intended Cortex chain is:
1. **discover / browse**
2. **retrieve / contextualize**
3. **validate**
4. **synthesize**

## 1. Discover / browse
Use L2 when the task needs fresh information or source discovery.

Examples:
- current docs
- live posts
- newly published information

## 2. Retrieve / contextualize
Bring in relevant memory or prior context.

Examples:
- what has already been decided
- how this topic fits existing project context
- what prior assumptions may matter

## 3. Validate
Check for contradictions, stale assumptions, weak evidence, or incomplete source coverage.

## 4. Synthesize
Only after discovery, context, and validation should the system produce the final answer.

## Why this is better than flat tool use

A flat tool model often fails by:
- over-trusting one source
- skipping context
- skipping validation
- pretending uncertainty does not exist

The research-chain model is meant to reduce that.

## Operational principle

If Cortex-first is the architecture, failures in the research chain should be surfaced explicitly rather than silently hidden behind fallback behavior.

## See also
- [Public docs index](INDEX.md)
- [Novelty index](NOVELTY_INDEX.md)
- [Architecture visual](ARCHITECTURE_VISUAL.md)

