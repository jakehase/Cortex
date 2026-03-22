# Oracle and multi-level publishability map

This page explains why the public repo does not contain the entire live implementation surface for Oracle and the other levels.

## Three buckets

### 1. Public-safe to publish
These are good candidates for the public repo:
- architecture docs
- routing-model docs
- cross-level orchestration patterns
- capability reality-checking concepts
- creativity-governor concepts
- public-safe tests or stripped reference implementations

### 2. Document-only for now
These are real implementation areas that should be explained publicly even if the exact live code is not published yet:
- Oracle bridge reliability strategy
- internal route-gate bypass rules for Oracle executor sessions
- session quarantine / transcript hygiene strategy
- implementation-state/control-plane guard logic
- level auto-activation and orchestration policies

### 3. Private / operational only
These should stay out of the public repo unless carefully rewritten:
- auth profiles
- private keys
- OpenClaw homes with auth state
- machine-specific deploy artifacts
- internal runtime state
- live operational bridge configs and service wiring tied to local infrastructure

## Public-safe implementation/doc surface already visible locally
Examples from the live workspace that are conceptually publishable:
- `plugins/cortex-route-gate/index.ts`
- `plugins/cortex-route-gate/creativity-governor.test.mjs`
- `docs/CROSS_LEVEL_ORCHESTRATION_PATTERNS.md`
- `docs/CORTEX_CAPABILITY_GUARD_CONTROL_PLANE.md`
- `docs/CORTEX_CAPABILITY_REGISTRY.md`
- `docs/ORACLE_BRIDGE_RELIABILITY_FIX_2026-03-21.md`

## Why the public repo looked incomplete
Because the public repo was being used mainly for public-safe framing/docs, while the live workspace and private backup held far more of the real implementation surface.

That made the architecture story more visible than the implementation story.

## Goal going forward
The right approach is:
1. map the implementation surface
2. separate public-safe from operational/private
3. publish the safe parts intentionally
4. document the rest honestly instead of pretending it does not exist
