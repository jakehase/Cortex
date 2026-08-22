# Super-agent stack

Cortex + OpenClaw should be understood as a modular super-agent stack.

## Why that label fits

This system is more than a chatbot and more than a single agent harness.
It combines:
- reasoning and routing
- memory
- browser/research grounding
- tools and plugins
- sessions and subagents
- channels and runtime delivery
- automation and scheduled work

## The split

### Cortex
Cortex handles:
- cognition
- routing
- memory interpretation
- browser/research-first behavior
- context synthesis

### OpenClaw
OpenClaw handles:
- runtime execution
- session orchestration
- tool exposure
- channels and messaging
- cron/jobs
- background work and delivery

## Why this is useful

The split allows the stack to:
- improve cognition without rewriting runtime plumbing
- improve runtime/channels without rewriting reasoning
- fail more transparently
- support multiple interaction modes instead of one fixed harness

## Design goal

The goal is a persistent agent runtime that can:
- chat
- browse
- remember
- delegate
- automate
- operate safely across multiple contexts

## See also
- [Public docs index](INDEX.md)
- [Novelty index](NOVELTY_INDEX.md)
- [Architecture visual](ARCHITECTURE_VISUAL.md)

