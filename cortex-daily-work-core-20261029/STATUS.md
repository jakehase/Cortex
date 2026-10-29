# Cortex Daily Work Core Status

## Metadata

- Project slug: `cortex-daily-work-core-20261029`
- Canonical plan: `plan.md`
- Decisions log: `DECISIONS.md`
- Last updated: 2026-10-29
- Status: real-path 404 reproduced / adapter repair source-qualified / deployment pending
- Current fidelity: `parity_for_scope`

## Current checkpoint

- Product implementation: all five bounded surfaces are complete at source product commit `1de5218d2807f577b5dd1ec3a8d92985d084347b`, already present on the configured remote.
- Active immutable release: `/opt/cortex/current -> /opt/cortex/releases/cortex-daily-work-core-1de5218d2807-20261029`.
- Focused verification for this activation: exactly one integrated smoke run is green for all five rows; artifact `artifacts/activation-smoke.json`.
- Default semantic integration: the loaded `cortex-route-gate` supplies proportional routing, evidence lifecycle/finalization/delivery hooks, source-backed attention, and the bounded `cortex_daily_work` tool; `cortex-memory-bridge` persists scoped corrections through canonical assurance/governance; everyday attention and workbench records reuse the existing decisions log.
- Tool policy: `tools.profile` remains `coding`; `tools.alsoAllow` is now `cortex_browse`, `cortex_browser_status`, and `cortex_daily_work`; existing denies remain `web_search`, `web_fetch`, and `browser`.
- Fresh-turn truth: a new turn loaded `cortex_daily_work`, but its actual read-only `attention_view` invocation returned HTTP 404 with FastAPI's exact 22-byte not-found body. Schema presence was not end-to-end success.
- Root cause: the tool uses `/everyday/*`; the live router was mounted only at `/everyday_intel/*`.
- Repair candidate: a fail-closed five-route `/everyday` adapter over the existing `everyday_intel` handlers and state has passed syntax and schema-construction checks. Production deployment is pending.

## Green implementation rows

1. Evidence-bound answers: host-observed usable/failed/aborted/empty outcomes, source-type binding for document claims, revision hook, and deterministic outbound qualification.
2. Source-backed attention: principal-scoped candidate/active/resolved events in the existing everyday log; exact current-user quote required by the default plugin; resolved items leave active view.
3. Proportional routing: rewrite/advise/execute/investigate mode; rewrite skips optional Oracle/deep levels while mandatory safeguards remain; consequential advice adds source/validator requirements.
4. Scoped correction transfer: direct-human correction candidates use stable same-scope fact keys through canonical assurance/governance; unrelated claim keys remain active; route-gate retrieves matching active correction memory.
5. Qualitative decision workbench: burden/cost/time/reversibility/uncertainty/missing evidence without numeric scores, weights, or fabricated winner.

## Verification result

```text
activationSmokeRunCount=1
passed=true
surfaceCount=5
freshTurnToolSchemaObserved=true
liveSyntheticToolInvocationObserved=false
actualParentToolInvocation=HTTP404
endToEndActivationGreen=false
externalSendInvoked=false
policyBypassInvoked=false
openClawUpdateOrUpgradeUsed=false
gatewayRestartUsed=false
```

Activation evidence:

- `artifacts/activation-smoke.json` — the one focused five-surface smoke run.
- `artifacts/activation-receipt.json` — config hash/policy, immutable release and startup-manifest hashes, runtime plugin source, source-release parity, and fresh-turn tool-schema proof.
- The startup code-manifest SHA-256 remains `fccdae970cea64c6db7ed508135178459506d4fdb584a325ea0045b68966a082`, matching the running gateway's expected digest.
- Config backup: `/opt/openclaw-preastra-restore/2026.7.1-2/state/openclaw.json.bak-cortex-daily-work-20261029T163951Z`.

The historical replay command remains documented in `plan.md`; do not rerun it merely to restate this activation because the approved verification budget was exactly one focused smoke.

## Active blocker and repair state

- The active `1de5218d2807` release is not end-to-end green: real tool transport reaches an unmounted `/everyday/attention/view` path and receives HTTP 404.
- Canonical source now contains the bounded adapter repair, but it is not yet deployed. Do not retry the tool or restore green status until the immutable release cutover and one real-path smoke succeed.

## Next actions

1. Commit/push the bounded adapter patch and focused real-path smoke harness.
2. Build a new immutable backend release; preserve the currently loaded, byte-identical route-gate plugin path; update target preflight and startup-manifest pins without updating OpenClaw.
3. Restart Cortex only, then run exactly one read-only real-path `attention_view` smoke through the registered tool factory.
4. Mark end-to-end active only from a non-empty `ok=true` result and unchanged canonical decisions state.

## Do not use / superseded

- `/root/clawd` dirty root — not an implementation or staging path for this change.
- `/root/clawd/.cortex-export` — retained clean recovery/export tree, but its relevant plugin files do not match the loaded plugins or this matching source worktree.

## Truth boundary

Allowed now:

- All five bounded semantic implementations exist, and the repair candidate mounts the five intended tool paths over the existing everyday handlers without creating a new state primitive.

Not allowed:

- Any end-to-end green or successful live invocation claim before the repaired release is active and the one real-path smoke passes; universal answer correctness; automatic discovery of every obligation; or any weakening of external-action and evidence gates.
