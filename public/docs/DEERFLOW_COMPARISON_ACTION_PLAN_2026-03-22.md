# DeerFlow comparison → Cortex/OpenClaw action plan

## Product framing
- Add a top-level explanation that:
  - Cortex = cognition layer
  - OpenClaw = execution/runtime layer
  - together = modular super-agent stack
- Rewrite README opening around outcomes first, architecture second.

## Capability docs
- Add a capabilities page covering:
  - web browsing / research
  - memory
  - channel messaging
  - subagents / sessions
  - coding-agent integrations
  - cron / scheduled work

## Channel UX docs
- Add one clear page for channel behavior:
  - direct vs group chat
  - auth / allowlist model
  - supported features by surface
  - reply / thread behavior

## Coding-agent docs
- Document ACP / coding-session flows:
  - one-shot vs persistent
  - thread-bound sessions
  - when to use isolated sessions
  - how tool exposure differs by runtime

## Extensibility docs
- Add one page explaining:
  - skills = task-specific operating instructions
  - plugins = runtime/tool capability providers
  - Cortex routes = reasoning/tool-selection policy
  - OpenClaw sessions = execution contexts

## Runtime clarity
- Document runtime modes more clearly:
  - main session
  - isolated session
  - ACP session
  - cron-triggered runs
  - local/core vs plugin vs Cortex tools

## Reliability / transparency
- Preserve explicit failure reporting:
  - Cortex-first failure should be surfaced
  - memory clean-but-empty should be explicit
  - filtered tool surfaces should be explicit
  - fallback use should be explicit

## Browser/L2 follow-up
- Keep Cortex browse split cleanly:
  - query-only -> `/browser/search`
  - url-targeted -> `/browser/browse`
- Add regression tests for both modes.

## Suggested priority order
1. README/front-door rewrite
2. Cortex vs OpenClaw architecture page
3. Capabilities page
4. Channels page
5. Coding-agent / ACP page
6. Extensibility model page
7. L2 regression tests
8. Operator restore/backup docs
