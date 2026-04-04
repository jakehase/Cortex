# WhatsApp thread-bound sessions enablement — 2026-04-04

## Goal
Enable `sessions_spawn({ thread: true, mode: "session" })` for the WhatsApp channel on this OpenClaw install.

## Grounding
- User request: build thread-bound sessions for WhatsApp.
- Runtime before patch: `thread=true is unavailable because no channel plugin registered subagent_spawning hooks.`
- Live install path patched: `/usr/lib/node_modules/openclaw/dist/auth-profiles-B5ypC5S-.js`

## Root cause
Subagent thread-binding for `sessions_spawn(thread=true)` only accepted the legacy `subagent_spawning` hook path.

WhatsApp on this install already exposed **current-conversation binding capability** through the shared session-binding service, but did **not** register the older subagent hook path. That meant:
- ACP thread/session binding could use the shared binding service
- plugin-driven current-conversation binding existed
- subagent spawn still hard-failed before trying that generic binding path

## Fix implemented
Added a fallback path in subagent spawn that:
1. detects the requester's current conversation on channels that support current-conversation binding
2. validates thread-binding policy via `resolveThreadBindingSpawnPolicy(...)`
3. binds the child subagent session to the current conversation using `getSessionBindingService().bind(...)`
4. preserves the older plugin-hook path if that hook exists

## Files added here in workspace
- Reapply script: `/root/clawd/scripts/patch-openclaw-whatsapp-thread-bound-sessions.mjs`
- Patch artifact: `/root/clawd/patches/openclaw-whatsapp-thread-bound-sessions.patch`

These are in the workspace repo because the live OpenClaw install under `/usr/lib/node_modules/openclaw` is not itself a Git repo on this machine.

## Validation
### Runtime / gateway
- Restarted gateway successfully after patch
- `openclaw gateway status` -> RPC probe ok

### Live end-to-end test
Ran a real spawn from this WhatsApp chat:
- `sessions_spawn(thread=true, mode="session", runtime="subagent")`

Observed result:
- accepted in `mode: "session"`
- returned a child session key
- wrote a live binding record to `/root/.openclaw/bindings/current-conversations.json`

Observed binding looked like:
- `channel: whatsapp`
- `accountId: default`
- `conversationId: +17855410986`
- `targetKind: subagent`
- `targetSessionKey: agent:main:subagent:...`

That proved WhatsApp thread-bound subagent sessions were working on this install.

### Cleanup after test
- Cleared the temporary test binding
- Restarted gateway
- verified bindings file returned to `[]`

## Semantics note
WhatsApp has no native Discord-style thread object.

So on WhatsApp, “thread-bound session” means:
- the **current conversation** is bound to a specific session
- follow-up messages in that chat route to the bound session until unbound/expired

This is closer to a durable **focus/binding** than to creating a visible child thread UI.

## Reapply
From workspace root:

```bash
node scripts/patch-openclaw-whatsapp-thread-bound-sessions.mjs
openclaw gateway restart
```

## Rollback
Options:
1. restore from the backup created beside the bundle
2. reinstall/update OpenClaw
3. or manually revert using the saved patch artifact

Example manual restore pattern:

```bash
cp /usr/lib/node_modules/openclaw/dist/auth-profiles-B5ypC5S-.js.bak-whatsapp-thread-bindings-<timestamp> \
   /usr/lib/node_modules/openclaw/dist/auth-profiles-B5ypC5S-.js
openclaw gateway restart
```

## Honest status
- **Implemented locally:** yes
- **Validated live on this WhatsApp chat:** yes
- **Packaged repeatably in workspace repo:** yes
- **Upstreamed into OpenClaw source repo:** no, not from this machine/session
