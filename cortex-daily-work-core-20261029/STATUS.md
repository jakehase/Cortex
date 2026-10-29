# Cortex Daily Work Core Status

## Metadata

- Project slug: `cortex-daily-work-core-20261029`
- Canonical plan: `plan.md`
- Decisions log: `DECISIONS.md`
- Last updated: 2026-10-29
- Status: deployed-active / registered-tool `attention_view` real-path green
- Current fidelity: `parity_for_scope`

## Current checkpoint

- Product implementation: the original five bounded surfaces remain at `1de5218d2807f577b5dd1ec3a8d92985d084347b`; the bounded route-adapter repair is source commit `1a283c5b4207808aaecb1eaeffc8fc16f429ecc6`, pushed to the configured remote.
- Active immutable release: `/opt/cortex/current -> /opt/cortex/releases/cortex-daily-work-route-adapter-1a283c5b42-20261029-v2`.
- Repair verification: exactly one post-cutover registered-tool real-path smoke invoked read-only `attention_view`, received non-empty `ok=true` from `/everyday/attention/view`, and left the canonical decisions state unchanged; artifact `artifacts/real-path-smoke.json`.
- Default semantic integration: the loaded `cortex-route-gate` supplies proportional routing, evidence lifecycle/finalization/delivery hooks, source-backed attention, and the bounded `cortex_daily_work` tool; `cortex-memory-bridge` persists scoped corrections through canonical assurance/governance; everyday attention and workbench records reuse the existing decisions log.
- Tool policy: `tools.profile` remains `coding`; `tools.alsoAllow` is now `cortex_browse`, `cortex_browser_status`, and `cortex_daily_work`; existing denies remain `web_search`, `web_fetch`, and `browser`.
- Incident truth: the first real parent-turn call returned HTTP 404 because the tool uses `/everyday/*` while the live router was mounted only at `/everyday_intel/*`; schema presence alone was not success.
- Repair: the active backend now mounts exactly five `/everyday` adapter routes over the existing `everyday_intel` handlers/state and fails startup if that set drifts.
- Cutover truth: the first packaged release lost executable bits, failed `203/EXEC`, rolled back automatically, and was quarantined. The corrected v2 release preserved Git executable modes and is active.
- OpenClaw was not updated, upgraded, or restarted. Gateway PID `916336`, config hash, tool policy, loaded plugin bytes, and safeguards remained unchanged. The on-disk next-start guard and code manifest now pin the new backend plus the still-loaded prior plugin release.

## Green implementation rows

1. Evidence-bound answers: host-observed usable/failed/aborted/empty outcomes, source-type binding for document claims, revision hook, and deterministic outbound qualification.
2. Source-backed attention: principal-scoped candidate/active/resolved events in the existing everyday log; exact current-user quote required by the default plugin; resolved items leave active view.
3. Proportional routing: rewrite/advise/execute/investigate mode; rewrite skips optional Oracle/deep levels while mandatory safeguards remain; consequential advice adds source/validator requirements.
4. Scoped correction transfer: direct-human correction candidates use stable same-scope fact keys through canonical assurance/governance; unrelated claim keys remain active; route-gate retrieves matching active correction memory.
5. Qualitative decision workbench: burden/cost/time/reversibility/uncertainty/missing evidence without numeric scores, weights, or fabricated winner.

## Verification result

```text
activationSmokeRunCount=1
repairRealPathSmokeRunCount=1
repairRealPathSmokePassed=true
verifiedAction=attention_view
verifiedEndpoint=/everyday/attention/view
preRepairParentToolInvocation=HTTP404
postRepairRegisteredToolResult=ok:true
canonicalDecisionsStateUnchanged=true
endToEndAttentionViewGreen=true
externalSendInvoked=false
policyBypassInvoked=false
openClawUpdateOrUpgradeUsed=false
gatewayRestartUsed=false
```

Activation evidence:

- `artifacts/activation-smoke.json` — the one focused five-surface smoke run.
- `artifacts/activation-receipt.json` — config hash/policy, immutable release and startup-manifest hashes, runtime plugin source, source-release parity, and fresh-turn tool-schema proof.
- `artifacts/real-path-smoke.json` — the single post-repair live registered-tool read smoke.
- `artifacts/route-repair-deployment.json` — root cause, active release, startup pins, rollback/quarantine, unchanged gateway/config/policy, and truth boundary.
- Current code-manifest SHA-256: `c8b991e608e6d1ad67338ae8c7b72097c4cefe7c3385a39b6a8cfceeb5d625d8`; target-preflight SHA-256: `9be6a25e7778587c563eb42d4be7a4bf463257a2ead3aae12143d7b0e529a859`.
- Rollback root: `/root/clawd/artifacts/cortex-daily-work-route-repair-20261029/rollback-20261029T1656Z`.
- Failed package quarantine: `/opt/cortex/releases/_quarantine/cortex-daily-work-route-adapter-1a283c5b42-20261029-failed-exec-mode`.

Do not rerun either focused smoke merely to restate status.

## Active blockers and remaining gaps

- No blocker remains for registered-tool read-only `attention_view`.
- The one-smoke repair contract did not invoke `attention_propose`, `attention_confirm`, `attention_resolve`, or `decision_workbench` in production. Their exact adapter routes are mounted and reuse already-qualified handlers, but this status does not claim live transaction evidence for those four actions.
- The running gateway retains its prior start-time environment because it was deliberately not restarted. The user-systemd next-start drop-in and startup manifest are updated and independently validate the current backend/loaded-plugin split.

## Next actions

1. Commit and push the final deployment/status artifacts.
2. Let later trusted user turns exercise the remaining actions only when genuinely needed; preserve exact-quote and no-external-action gates.
3. Do not restart or update OpenClaw solely to restate this repair.

## Do not use / superseded

- `/root/clawd` dirty root — not an implementation or staging path for this change.
- `/root/clawd/.cortex-export` — retained clean recovery/export tree, but its relevant plugin files do not match the loaded plugins or this matching source worktree.

## Truth boundary

Allowed now:

- The bounded semantic implementations remain active, all five intended adapter routes are mounted over the existing everyday handlers without a parallel state primitive, and registered-tool transport is live-green for read-only `attention_view`.

Not allowed:

- A claim that the four uninvoked mutation/workbench actions have live transaction proof; universal answer correctness; automatic discovery of every obligation; or any weakening of external-action and evidence gates.
