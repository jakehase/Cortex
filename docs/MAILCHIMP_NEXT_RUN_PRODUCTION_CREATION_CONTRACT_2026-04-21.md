# Mailchimp next-run production-creation contract, 2026-04-21

## Reply anchor
Jake asked when actual production creation testing starts. The answer was: the **next serious Mailchimp run**, not another qualification-style pass. Jake then said: **do it**.

## Status
Prepared, not launched.

## Purpose
Convert the next Mailchimp run from a live-worker qualification into an actual product-creation gate.

This contract is designed to answer one question honestly:

Can the system produce sustained, multi-agent, verifier-backed **product work** on Mailchimp surfaces for at least two hours?

## Bound files
- Run contract: `/root/clawd/large-project-capability-stack/artifacts/benchmarks/mailchimp_production_creation_gate/prep-20260421-1039/run_contract.json`
- Surface matrix: `/root/clawd/large-project-capability-stack/artifacts/benchmarks/mailchimp_production_creation_gate/prep-20260421-1039/surface_matrix.json`

## Exact benchmark shape
- Benchmark id: `mailchimp_production_creation_gate`
- Benchmark tier: `tier2_production_creation_gate`
- Repo: `/home/jake/clawd-remote/mailchimp-clone`
- Control-plane repo: `/root/clawd/mailchimp-clone`
- Fidelity: `parity_for_scope`
- Requested agent count: `10`
- Duration target: `120 minutes`
- Stop condition: `supervisor_green_or_blocker_report`
- Execution boundary: `remote_execution_required`
- Artifact root: `/root/clawd/mailchimp-clone/artifacts/full_audit_campaign`

## Launch command
Run from `/root/clawd/mailchimp-clone`:

```bash
ORCHESTRATOR_TIERS=10 \
MAILCHIMP_PARITY_MAX_RUNTIME_HOURS=2 \
MAILCHIMP_PRODUCT_ONLY=1 \
MAILCHIMP_USE_STRICT_GAP_INVENTORY=1 \
MAILCHIMP_STRICT_GAP_SEQUENCE=1 \
node scripts/full-audit-campaign-launch.mjs
```

## What must be true before launch
1. The planner exposes at least `10` executable product shards.
2. Those shards cover at least `3` unresolved focus lanes.
3. Each counted shard binds allowed product files.
4. LOC accounting is present and enforced.
5. The run is remote on VM102, not heavy local execution.

## What counts as success
All of these must happen in one honest run:
- at least `120` minutes of productive autonomy
- at least `150` changed lines on counted product files
- at least `8` counted product files changed
- accepted product diffs in at least `3` focus lanes
- accepted counted patches from at least `4` agent ids
- no-op rate `<= 0.20`
- repeat-blocker rate `<= 0.15`
- verification integrity `>= 0.95`
- truth contradictions `0`

## What does not count
None of these may be credited as product creation:
- scripts-only churn
- supervisor/notifier/reporting churn
- docs/tests/artifacts-only changes
- verification-only shards
- tiny surviving diffs dressed up as a successful long run

## Why this contract exists
The last tier-10 run proved remote orchestration could finish cleanly, but it only left one surviving product file change: `packages/app/storage.mjs` with `+17/-2`.

That was not actual production creation.

This contract is the line where the next run either proves real product throughput or the project pauses/pivots honestly.
