# Capabilities

This page is outcome-first, not architecture-first.

## Messaging and channels

The stack can:
- participate in direct chats
- behave differently in direct vs group contexts
- route replies back through supported messaging providers
- manage cross-session communication

## Web browsing and research

The stack can:
- browse the web through Cortex browser tools
- inspect a specific URL
- search for fresh information
- fall back to generic web tools when Cortex browse is unavailable
- explicitly report when fallback was required

## Memory

The stack can:
- retrieve prior durable memory
- distinguish between fast recall and harder memory investigation
- suppress internal/noisy memory from normal user recall
- report when memory is clean-but-empty instead of pretending it succeeded

## Sessions and delegation

The stack can:
- spawn isolated sessions
- delegate work to subagents
- maintain persistent ACP/coding sessions
- route work across separate execution contexts

## Tools and automation

The stack can:
- use local/core tools
- use plugin-provided tools
- schedule cron jobs and reminders
- run background work and return later with results

## Coding-agent workflows

The stack can:
- launch coding-agent sessions
- keep thread-bound persistent coding sessions
- run one-shot isolated coding tasks
- distinguish between normal chat and code-execution contexts

## Failure transparency

This stack should prefer explicitness over pretending.

Examples:
- if Cortex-first browsing fails, say so
- if a tool is filtered by policy, say so
- if memory is empty after noise suppression, say so
- if fallback is used, say so
