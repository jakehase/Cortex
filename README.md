# Cortex + OpenClaw

Cortex + OpenClaw is a modular super-agent stack.

- **Cortex** is the cognition layer:
  - routing
  - memory
  - browser/research grounding
  - context synthesis
- **OpenClaw** is the execution/runtime layer:
  - channels
  - sessions
  - tools
  - cron
  - subagents
  - automation plumbing

Together, they form a persistent agent runtime that can chat across channels, browse the web, remember durable context, delegate work, run coding agents, and operate across multiple sessions.

## What it can do

- chat on messaging surfaces like WhatsApp and other supported channels
- browse and research with Cortex browser tools
- remember durable context and retrieve it later
- delegate work to isolated subagents and coding sessions
- schedule reminders and recurring tasks
- route work across sessions, tools, and channels

## Mental model

- Read **`docs/CORTEX_VS_OPENCLAW.md`** for the architecture split
- Read **`docs/CAPABILITIES.md`** for concrete outcomes
- Read **`docs/CHANNELS.md`** for channel/runtime behavior
- Read **`docs/CODING_AGENT_SESSIONS.md`** for ACP/coding flows
- Read **`docs/EXTENSIBILITY_MODEL.md`** for skills/plugins/routes/sessions

## Practical principles

- Cortex-first when Cortex capabilities exist
- explicit fallback when Cortex is unavailable or broken
- clear failure reporting over silent papering-over
- private memories and backups over convenience when security is at stake

## Current notes

- L2 browser query-only mode uses `/browser/search`
- URL-targeted browse mode uses `/browser/browse`
- memory search now distinguishes between useful memory, internal noise, and clean-but-empty results

## Related docs

- `docs/DEPLOY.md`
- `docs/RESTORE_PLAN_2026-03-14.md`
- `docs/DEERFLOW_COMPARISON_ACTION_PLAN_2026-03-22.md`
