# Cortex Daily Work Core Status

## Metadata

- Project slug: `cortex-daily-work-core-20261029`
- Canonical plan: `plan.md`
- Decisions log: `DECISIONS.md`
- Last updated: 2026-10-29
- Status: implementation-green / deployment pending
- Current fidelity: `parity_for_scope`

## Current checkpoint

- Product implementation: all five bounded surfaces are complete in the clean source worktree.
- Focused verification: one integrated smoke is green for exactly five rows; artifact `artifacts/integrated-smoke.json`.
- Default integration observed in smoke: `cortex-route-gate` registers the evidence/finalization hooks and `cortex_daily_work`; Cortex everyday routes are present; canonical memory governance performs same-scope supersession.
- Current source base: `28ffec514d3b` plus the uncommitted candidate diff in `/root/clawd/_worktrees/oracle-expiring-oauth-20261026`.
- Deployment state: staged, not yet deployed.

## Green implementation rows

1. Evidence-bound answers: host-observed usable/failed/aborted/empty outcomes, source-type binding for document claims, revision hook, and deterministic outbound qualification.
2. Source-backed attention: principal-scoped candidate/active/resolved events in the existing everyday log; exact current-user quote required by the default plugin; resolved items leave active view.
3. Proportional routing: rewrite/advise/execute/investigate mode; rewrite skips optional Oracle/deep levels while mandatory safeguards remain; consequential advice adds source/validator requirements.
4. Scoped correction transfer: direct-human correction candidates use stable same-scope fact keys through canonical assurance/governance; unrelated claim keys remain active; route-gate retrieves matching active correction memory.
5. Qualitative decision workbench: burden/cost/time/reversibility/uncertainty/missing evidence without numeric scores, weights, or fabricated winner.

## Verification result

```text
passed=true
surfaceCount=5
externalSendInvoked=false
policyBypassInvoked=false
```

Replay:

```bash
cd /root/clawd/_worktrees/oracle-expiring-oauth-20261026
python3 cortex-daily-work-core-20261029/smoke_five_improvements.py \
  --artifact cortex-daily-work-core-20261029/artifacts/integrated-smoke.json
```

## Active blockers

- No implementation blocker.
- Deployment requires the existing immutable release/plugin-path/startup-manifest flow. The gateway currently pins both plugin paths and startup manifest to prior releases; those gates must be updated together rather than bypassed.

## Next actions

1. Commit only this worktree diff and push the branch.
2. Build an immutable bounded release from the committed tree.
3. Preserve/update exact plugin paths plus startup manifest pins, restart Cortex and the gateway through the approved flow, then verify live identities/endpoints.
4. Mark every matrix row `deployed` only after those live checks.

## Do not use / superseded

- `/root/clawd` dirty root — not an implementation or staging path for this change.
- `/root/clawd/.cortex-export` — retained clean recovery/export tree, but its relevant plugin files do not match the loaded plugins or this matching source worktree.

## Truth boundary

Allowed now:

- All five bounded product surfaces are implemented and green in the focused integrated smoke.

Not allowed yet:

- A deployed/live claim, universal answer correctness, or automatic discovery of every obligation.
