# Cortex vs OpenClaw

## Short version

- **Cortex** = cognition layer
- **OpenClaw** = execution/runtime layer

Together they make a modular super-agent stack.

## Cortex

Cortex is responsible for:
- reasoning/routing
- memory retrieval and synthesis
- browser/research grounding
- contextual interpretation
- deciding which level/tooling path best fits a request

In practice, Cortex is the part that tries to answer:
- what kind of task is this?
- what evidence should be gathered?
- what memory or browsing path should be used?
- how should uncertainty be handled?

## OpenClaw

OpenClaw is responsible for:
- messaging/channel plumbing
- session management
- tool mediation
- cron/jobs/reminders
- subagent orchestration
- runtime/plugin loading
- policy-filtered tool exposure

In practice, OpenClaw is the part that handles:
- where messages come from
- which tools are available in a session
- how agents spawn/isolate/resume
- how tasks are scheduled and delivered

## Why the split matters

A lot of agent systems collapse everything into one harness. This stack does not.

Advantages of the split:
- cognition can improve without redefining runtime plumbing
- runtime/channels can improve without rewriting the reasoning layer
- failures are easier to localize
- tool exposure and policy can be separated from routing intent

## Example

A user asks about a live X post.

- Cortex decides browsing should be used first
- OpenClaw exposes the browser tool surface and routes the result back into chat
- if the browser path fails, OpenClaw can still provide fallback tools while Cortex explains the failure mode

## Guiding principle

Do not confuse:
- **what should be done** (Cortex)
with
- **what can be executed in this session** (OpenClaw)

Both matter.
