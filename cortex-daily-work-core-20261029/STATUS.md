# Cortex Daily Work Core Status

## Metadata

- Project slug: `cortex-daily-work-core-20261029`
- Canonical plan: `plan.md`
- Decisions log: `DECISIONS.md`
- Last updated: 2026-10-29
- Status: deployed-active / fresh-turn tool loading verified
- Current fidelity: `parity_for_scope`

## Current checkpoint

- Product implementation: all five bounded surfaces are complete at source product commit `1de5218d2807f577b5dd1ec3a8d92985d084347b`, already present on the configured remote.
- Active immutable release: `/opt/cortex/current -> /opt/cortex/releases/cortex-daily-work-core-1de5218d2807-20261029`.
- Focused verification for this activation: exactly one integrated smoke run is green for all five rows; artifact `artifacts/activation-smoke.json`.
- Default semantic integration: the loaded `cortex-route-gate` supplies proportional routing, evidence lifecycle/finalization/delivery hooks, source-backed attention, and the bounded `cortex_daily_work` tool; `cortex-memory-bridge` persists scoped corrections through canonical assurance/governance; everyday attention and workbench records reuse the existing decisions log.
- Tool policy: `tools.profile` remains `coding`; `tools.alsoAllow` is now `cortex_browse`, `cortex_browser_status`, and `cortex_daily_work`; existing denies remain `web_search`, `web_fetch`, and `browser`.
- Fresh-turn proof: a new turn's recorded model tool schema contains `cortex_daily_work`, and runtime plugin inventory identifies its source in the active release.
- Deployment state: active for the bounded five-surface default path. No OpenClaw update, upgrade, or gateway restart was used.

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

## Active blockers and remaining gap

- No implementation, release-integrity, config-activation, or new-turn tool-loading blocker.
- Two no-delivery synthetic CLI attempts loaded the tool but were stopped before model execution by `CORTEX_REQUIRED_HOOK_FAILED`; therefore this status does **not** claim a successful live `cortex_daily_work` invocation. Neither attempt made an external send. A normal trusted inbound turn can supply that final invocation evidence when the tool is next needed.

## Next actions

1. Commit and push this documentation/evidence-only activation record; do not rebuild or mutate the immutable `1de5218d2807` release.
2. On a later normal trusted user turn that genuinely needs attention or decision support, use `cortex_daily_work` and record success only from its actual non-empty result.
3. Keep the current tool profile, deny list, signed-principal checks, exact-quote attention gates, and external-write safeguards unchanged.

## Do not use / superseded

- `/root/clawd` dirty root — not an implementation or staging path for this change.
- `/root/clawd/.cortex-export` — retained clean recovery/export tree, but its relevant plugin files do not match the loaded plugins or this matching source worktree.

## Truth boundary

Allowed now:

- All five bounded product surfaces are implemented in the active immutable release, integrated into the default semantic hooks, green in the single activation smoke, and present in a fresh turn's tool schema.

Not allowed:

- A claim that either synthetic CLI attempt successfully invoked the tool, universal answer correctness, automatic discovery of every obligation, or any weakening of external-action and evidence gates.
