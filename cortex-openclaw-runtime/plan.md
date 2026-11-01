# Cortex-Native OpenClaw Runtime Plan

## Plan metadata

- Project slug: `cortex-openclaw-runtime`
- Plan owner: Jake + Cortex
- Created: 2026-11-01
- Last updated: 2026-11-01
- Status: active
- Fidelity target: production_slice
- Primary stop condition: `focused_e2e_smoke_green_or_blocker`
- Status file: `STATUS.md`
- Decisions log: `DECISIONS.md`
- Plan index entry: `/root/clawd/docs/PLAN_INDEX.md`

## 1. Working name

Cortex-Native OpenClaw Runtime

## 2. Decision summary

Extend the existing Cortex OpenClaw plugin path so Cortex owns the cognitive turn lifecycle while OpenClaw remains the hardened channel, model, session, tool, approval, scheduler, and delivery runtime. The active implementation is the clean worktree `/root/clawd/worktrees/cortex-openclaw-runtime-20261101`, created from the exact live plugin commit `1de5218d2807f577b5dd1ec3a8d92985d084347b`; it does not create a standalone harness and does not patch OpenClaw core. The first production slice introduces a versioned OpenClaw compatibility adapter around the already-live Cortex lifecycle hooks, proves one complete inbound-turn lifecycle through that adapter, and packages the result for reversible installation. This plan does not yet claim that Cortex replaces OpenClaw's low-level model executor.

## 3. Core thesis / objective

- Primary objective: make Cortex the native cognitive control layer inside OpenClaw through a stable plugin boundary.
- User/operator served: Jake, through the existing main OpenClaw/Cortex assistant.
- Desired outcome: OpenClaw upgrades require changes only at a small compatibility boundary instead of changes throughout Cortex.
- Existing gap: the live Cortex route gate already participates in prompt construction, tools, output, delivery, and agent-end handling, but its OpenClaw event-shape assumptions are embedded directly throughout the plugin.
- Success changes: OpenClaw-specific hook names and event projections become versioned, inspectable, smoke-testable, and replaceable without rewriting Cortex logic.

## 4. Scope

In scope:

- Versioned adapter for OpenClaw lifecycle hooks used by the Cortex route gate.
- Cortex-owned normalized turn lifecycle events for prompt, compaction, tool calls, persisted tool results, model output, delivery, and agent end.
- Reuse of the live Cortex route, memory, policy, evidence, continuity, and validation path.
- Explicit OpenClaw compatibility metadata and required-hook checks.
- One focused end-to-end smoke covering a complete simulated OpenClaw turn through Cortex routing, one tool result, model output, and agent-end cleanup.
- Reversible release packaging and activation only after the focused smoke passes.

## 5. Non-goals

Out of scope for the first production slice:

- A second standalone agent framework.
- A permanent OpenClaw fork.
- Reimplementation of channels, authentication, tools, approvals, scheduling, transcripts, or delivery.
- Harness-to-harness chaining, which the current public OpenClaw SDK does not expose.
- Replacing OpenClaw's embedded or Codex low-level model executor in the first slice.
- Broad regression campaigns, benchmarks, or canaries beyond the one approved focused smoke.
- Automatic OpenClaw upgrades without qualification.

Eventual ambition:

- Cortex owns the full cognitive turn state machine, with OpenClaw supplying runtime services through a thin adapter.

Current milestone:

- Isolate and prove the compatibility adapter around the already-live Cortex lifecycle.

## 6. Active path / repo layout

Active lifecycle path:

```text
/root/clawd/cortex-openclaw-runtime
```

Active implementation paths:

```text
/root/clawd/worktrees/cortex-openclaw-runtime-20261101/plugins/cortex-route-gate          # clean exact-live implementation base
/root/clawd/worktrees/cortex-openclaw-runtime-20261101/plugins/cortex-route-gate/compat   # versioned OpenClaw adapter
/root/clawd/worktrees/cortex-openclaw-runtime-20261101/plugins/cortex-route-gate/native-runtime-smoke.mjs # focused lifecycle smoke
/root/clawd/cortex-openclaw-runtime                                                    # plan/status/decisions/evidence map
```

Live release path remains versioned under:

```text
/opt/cortex/releases/<qualified-release>/plugins/cortex-route-gate
```

Path rules:

- Do not modify OpenClaw files under `/opt/openclaw-preastra-restore/.../runtime/openclaw`.
- Do not use `_quarantine`, `.cortex-export`, old campaign worktrees, or historical release snapshots as active source.
- Existing sibling Cortex plugins remain unchanged unless a verified interface dependency requires a narrow change.
- The root workspace is dirty with unrelated historical work and its plugin copies differ from the configured live release. Implementation must occur only in the clean exact-live worktree; commits and release packets must include only this project's explicit files.

## 7. Prior art and existing assets

Prior-art gate decision: `extend_existing`

Prior-art artifact:

```text
/tmp/cortex-harness-prior-art.json
```

Gate result:

```text
green_prior_art_gate / extend_existing_or_adapter_required
```

Existing assets to reuse:

- `/root/clawd/plugins/cortex-route-gate/index.ts`
- `/root/clawd/plugins/cortex-memory-bridge`
- `/root/clawd/plugins/cortex-principal-identity.mjs`
- OpenClaw public lifecycle hooks and agent-harness runtime helpers
- Current versioned Cortex release packaging

Known duplication risks:

- Creating another memory layer, route gate, tool policy engine, or model executor.
- Duplicating the bundled Codex harness instead of adapting the existing executor.

Decision:

- Extend the existing route gate and add an adapter boundary. Do not create a parallel harness primitive.

## 8. Target architecture

Architecture summary:

```text
Inbound channel
  -> OpenClaw gateway/session/auth/tool runtime
  -> versioned Cortex/OpenClaw compatibility adapter
  -> Cortex cognitive lifecycle
       route + memory + policy + continuity + evidence + validation
  -> existing OpenClaw/Codex model executor
  -> compatibility adapter
  -> Cortex outcome/learning lifecycle
  -> OpenClaw transcript/delivery
```

Subsystems:

- **OpenClaw runtime shell**: channels, auth, sessions, transcripts, model resolution, tools, approvals, scheduling, media, delivery.
- **Compatibility adapter**: validates required hooks and normalizes OpenClaw events into Cortex-owned event shapes.
- **Cortex cognitive lifecycle**: routing, context, continuity, tool observations, output validation, contradiction checks, and outcome learning.
- **Cortex server/memory**: scoped retrieval, durable state, policy, and knowledge services.

Key boundaries:

- OpenClaw-specific field access belongs in the compatibility adapter.
- Cortex logic consumes normalized adapter events and does not depend on OpenClaw package internals.
- No external action authority is added by the adapter.
- OpenClaw remains authoritative for tool permissions, approvals, session delivery, and model/provider authentication.

Interface contract:

```text
cortex.openclaw.compat.v1
  register(api, handlers)
  metadata(): adapter version, tested OpenClaw range, required hooks
  normalizePrompt(event, context)
  normalizeCompaction(event, context)
  normalizeToolCall(event, context)
  normalizePersistedToolResult(event)
  normalizeModelOutput(event, context)
  normalizeDelivery(event, context)
  normalizeAgentEnd(event, context)
```

Architecture decisions:

| Decision | Options considered | Chosen option | Reason | Revisit when |
|---|---|---|---|---|
| Runtime shape | standalone harness, OpenClaw core fork, plugin adapter | plugin adapter | reuses mature runtime and isolates upgrades | public SDK exposes safe harness composition or current hooks become insufficient |
| Executor | duplicate model loop, bundled/current executor | current executor | avoids duplicate auth/tools/session logic | a Cortex-owned executor proves a specific material benefit |
| Activation | immediate main-session replacement, staged qualification | staged qualification | protects the live WhatsApp lane | focused smoke and release preflight pass |
| Updates | automatic, pinned plus smoke | pinned plus smoke | experimental SDK may change | adapter API becomes stable and backward-compatible |

## 9. Surface matrix / ownership

| Surface | Owner | Primary files | Allowed write scope | Verifier | Claim allowed when |
|---|---|---|---|---|---|
| Compatibility adapter | implementer | `worktrees/cortex-openclaw-runtime-20261101/plugins/cortex-route-gate/compat/**` | adapter only | focused lifecycle smoke | OpenClaw events normalize and dispatch correctly |
| Route-gate integration | implementer | `worktrees/cortex-openclaw-runtime-20261101/plugins/cortex-route-gate/index.ts` | narrow hook-registration block | focused lifecycle smoke | existing handlers run through adapter |
| Plugin manifest | implementer | `plugins/cortex-route-gate/openclaw.plugin.json` | metadata/version only | manifest load in smoke | plugin remains discoverable |
| Lifecycle evidence | verifier | `cortex-openclaw-runtime/**` | status/decisions/evidence only | direct inspection | state matches observed result |
| Live release | release operator | `/opt/cortex/releases/**` and pointer/config only | new versioned release plus atomic pointer/config | installed plugin inspection | qualified source is installed and selected |

## 10. Agent strategy

Agent count target: 1 implementer plus 1 independent read-only reconnaissance worker.

Execution placement:

- Control plane: CT101 `/root/clawd`
- Execution plane: local for this bounded plugin edit and focused smoke
- Remote boundary required: no for the bounded slice
- Heavy execution allowed locally: no

Roles:

- planner: bind existing route-gate architecture and upgrade boundary
- implementer: add adapter and narrow integration
- verifier: run exactly one focused smoke and inspect the diff
- release operator: package and apply only the qualified files

## 11. Phases

### Phase 0: Grounding and prior art

Outputs:

- Exact reply anchor and target paths
- Prior-art decision
- Current live plugin and OpenClaw version inventory

Acceptance:

- Prior-art gate is green.
- Active source is `/root/clawd/plugins/cortex-route-gate`.
- OpenClaw core remains untouched.

### Phase 1: Versioned compatibility adapter

Outputs:

- Adapter module and metadata
- Route gate registered through adapter
- Focused lifecycle smoke

Acceptance:

- One smoke drives prompt, tool, output, and end events through the adapter.
- Prompt context includes a valid Cortex route block.
- Tool outcome is observed.
- Output is observed.
- Agent-end cleanup occurs.
- No OpenClaw core file changes.

### Phase 2: Qualified release packaging

Outputs:

- Versioned Cortex release containing the adapter slice
- Exact source and evidence hashes
- Reversible pointer/config change, if activation requires one

Acceptance:

- Release contains only intended project files plus unchanged required sibling plugins.
- Existing secrets/config are preserved.
- The live plugin source resolves to the qualified release.

### Phase 3: Default-path activation

Outputs:

- Cortex cognitive lifecycle remains enabled on the canonical main path.
- OpenClaw version pin and adapter compatibility declaration are recorded.

Acceptance:

- The qualified plugin is loaded.
- The current session continues to use the OpenClaw runtime shell with Cortex lifecycle hooks active.
- Rollback target is recorded.

## 12. Focused verification contract

Exactly one focused smoke is authorized for this implementation:

```bash
node /root/clawd/worktrees/cortex-openclaw-runtime-20261101/plugins/cortex-route-gate/native-runtime-smoke.mjs
```

The smoke must prove one meaningful end-to-end lifecycle, not broad efficacy or regression freedom. It may use a deterministic local Cortex route fixture, but it must load the actual plugin entry and adapter implementation.

Required evidence:

- plugin registered all required hooks through the adapter
- prompt hook returned Cortex system context
- tool event was captured
- model output was captured
- agent end removed in-flight state
- adapter metadata matches the currently tested OpenClaw release

## 13. Upgrade and rollback policy

For each OpenClaw update:

1. Keep the current qualified OpenClaw and Cortex release available.
2. Update only the adapter's declared tested version after direct inspection.
3. Run the one focused lifecycle smoke against the candidate OpenClaw SDK.
4. Promote only if the smoke passes.
5. Roll back the OpenClaw package or Cortex release pointer if activation fails.

Never patch Cortex logic directly into OpenClaw core.

## 14. Truth boundary

A green focused smoke proves only that the Cortex lifecycle adapter mechanically works for the tested path and OpenClaw version. It does not prove universal compatibility, better intelligence, broad regression freedom, or that Cortex owns the low-level model executor.

Completion for the current milestone means the adapter slice is implemented, qualified by the single smoke, installed reversibly, and active on the canonical plugin path. The broader Cortex-native agent-loop ambition remains open until later phases move additional lifecycle ownership behind the same boundary.

## 15. Risks and mitigations

- **Experimental SDK churn:** pin OpenClaw version and isolate hook shapes in one adapter.
- **Live-channel interruption:** package first, activate only after smoke, keep rollback release.
- **Duplicate architecture:** extend existing route gate and memory bridge only.
- **Dirty workspace contamination:** inspect explicit diff paths and package from an allowlist.
- **False completion claim:** distinguish adapter lifecycle ownership from low-level executor ownership.
- **External-action safety drift:** leave tool policy and approvals with OpenClaw.

## 16. Estimates

Current production slice:

- Engineering time: roughly 2 to 4 focused hours
- Model work: one implementation lane plus one read-only reconnaissance lane
- Verification: one deterministic focused smoke
- Compute: light, local control-plane only
- Deployment interruption: one bounded gateway reload/restart only if required for plugin activation

Later full cognitive-loop extraction:

- Engineering time: multiple staged milestones, likely several days
- Verification: separate approval required before any broader campaign
