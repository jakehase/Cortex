# Channels

## Purpose

This page explains how messaging surfaces and session behavior fit together.

## Direct vs group behavior

Direct chats:
- default to being more responsive
- can use private long-term memory when appropriate
- are safer for personalized context

Group chats:
- should not leak private memory or user data
- should speak only when useful
- should avoid over-participating

## Channel/runtime relationship

A message surface is not the same thing as a session.

- channels deliver messages
- sessions hold execution context
- OpenClaw decides how replies route back

## Tooling implications

Depending on the runtime/session, a channel interaction may have access to:
- core tools
- plugin tools
- Cortex browser tools
- subagent/session tools

Tool surfaces may be policy-filtered by session.

## Operational expectations

When a channel issue happens, check:
- auth / allowlist state
- provider connectivity
- session routing
- tool exposure for the current session
- whether the issue is channel-side or runtime-side
