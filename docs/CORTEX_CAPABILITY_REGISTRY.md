Cortex capability registry and preflight

Purpose
- stop duplicate or premature upgrades
- force a check of what is already implemented, live, verified, or blocked before new Cortex upgrade work

Files
- registry: `state/cortex-capabilities.json`
- preflight: `scripts/cortex-capability-preflight.mjs`

Usage
- list all capabilities:
  - `node scripts/cortex-capability-preflight.mjs`
- check a proposed upgrade before doing it:
  - `node scripts/cortex-capability-preflight.mjs browser bridge`
  - `node scripts/cortex-capability-preflight.mjs memory write through`
  - `node scripts/cortex-capability-preflight.mjs governor`

Expected workflow before every Cortex change
1. run preflight for the proposed upgrade
2. check whether an overlapping capability is already:
   - implemented
   - live
   - verified
   - blocked
3. only then decide whether to:
   - fix an existing capability
   - finish verification
   - or build something new

Current intended effect
- prevents re-implementing features that already exist in code
- distinguishes coded vs live vs verified
- makes blockers explicit instead of hidden in chat history
