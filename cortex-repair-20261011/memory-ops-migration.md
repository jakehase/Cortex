# Memory and operations repair migration notes

Scope: MEM-2, MEM-3, AIOS-1, and source-side OPS-2 only.

## Memory conflict and supersession

- No governance database schema migration is required.
- Existing fact rows and edges are retained; this repair never deletes memory history.
- The legacy `same_claim_different_value` edge reason is treated as ambiguous historical evidence, not sufficient proof of contradiction. Explicit `contradicts_ids`/`contradicts_id` relations, or a declared `claim_semantics`, `value_semantics`, or `claim_cardinality` of `exclusive`, continue to create genuine conflicts.
- Replaying a fact write upgrades newly declared contradiction and supersession relations to the explicit edge reasons. No live replay is performed by this change.
- Temporal-v1 `supersedes_json` is now consumed by the governance projection. Superseded rows are excluded from the current view while their validity window remains queryable with `as_of`.

## Owner index

- Owner-index receipt schema remains `cortex.owner-file-index.v3`.
- `lastVerification` is additive. Existing v3 receipts can use a healthy `lastCheck` or successful `lastRun` as the initial bounded verification receipt.
- The source timer invokes `apply` every five minutes, but exact backend read/search verification is reused for at most 3600 seconds only when two source snapshots, signed principal scope, policy digest, privacy partition, accepted records, pending state, and health all agree.
- Set `--verification-max-age-seconds 0` for an operator-forced exact backend verification. The maximum accepted interval is 86400 seconds.
- The new unit files are source assets only; installation, enablement, or changes to live units remain a release/control-plane action.

## AI OS evidence refresh

- Run `node scripts/aios-adapter.mjs refresh-evidence --artifact-root <ai-os-artifact-root>` to write a fresh local integrity report.
- The command reads the existing exact job, boot, run, process, verifier, claim, tenant, and provider-policy artifacts; it does not run the job, invoke a provider, add a capability, or perform an external write.
- A refresh can restore bounded adapter status/recovery evidence, but it does not make the historical execution current and cannot satisfy completion-claim or default-promotion authority gates.
- The refresh report expires under the existing AI OS evidence-age bound and must be regenerated when status evidence expires.

## Stale jobs

- `ops/contracts/stale-job-quarantine-recovery.v1.json` is deliberately non-applying and contains no guessed live targets.
- A control-plane worker must populate exact targets from a fresh read-only inventory, obtain approval for the inventory digest, then apply the per-target quarantine transaction.
- Active user reminders and required release surfaces are protected. Recovery restores exact bytes and prior scheduler state without triggering the recovered payload.
