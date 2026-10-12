# Cortex Post-Audit Repair 2026-10-11 — Integration Review

Review date: 2026-10-12  
Baseline: `repair/cortex-20261011` at `15d1ee5c04f846564acdeaa4ef7bb373fcaac41c`  
Verdict: **not ready for control-plane integration or promotion**

This was a source-only integration review. No service, live database, live configuration, credential, deployment, remote ref, or other control-plane state was changed. No full suite was run. No completion or deployment is claimed.

## Inputs and safety review

`plan.md` and `surface-matrix.json` were read before patch review. Every recovered patch and companion archive was reviewed independently. The archives contained only bounded relative regular-file paths; no absolute paths, traversal entries, links, devices, or secret-pattern matches were accepted. No benchmark-only repair was accepted.

| Worker set | Working patch SHA-256 | Archive SHA-256 | Decision |
|---|---|---|---|
| route-memory | `ce4bcd8b7ca7ee16f1489a3aacc1601265c541dc83237e282ee9ced8c3598b65` | `bd4f5154e6010b8ba2f35b22f2eba20a5b29402e49f59f6945996405cc04c451` | Accepted and merged |
| health-parser | `c0e44ff5a61f6604f5dd3ee792876ef93268ea59ab9a6045492b370214a7c602` | `42b5030ad66ce9456f9d3f879439393b4d5273370c12d66a72772248fa0f0184` | Accepted and merged |
| security-policy | `fb3f62b3f48733154d7a3b8972bff8844dd13e336e28af4e122196d8895d46a6` | `d4b10d5fd911fb0cff931c3beb5d39553468c9c0b20b0cb7f80bbb5800ea350e` | Accepted with one rejected status-only hunk |
| memory-ops | `3a4f5958482b198cf086ea9cfe2867f882b29347aed3da85c9999d651fac3e60` | `c758e7388831ddb198b591cfecb46f034297eca577caa3cc241537ce9e527d75` | Accepted and merged |
| release-provenance | `5c8f3b636f807e59327c4c7c10571ff63379ae92089e070fc11a11a533f863e2` | `a95303882290da8596db7a1825706aadfbc3de3a831ded741d21e478e7ca449b` | Accepted and merged |

## Accepted changes

- Route/memory: authenticated parent-to-child delegation envelopes, fail-closed subagent trust, a bounded required-route deadline, and trusted lifecycle persistence.
- Health/parser: one canonical health vocabulary and aggregation model, honest restricted/stale/disabled states, bounded PDF parsing through supported backends, and controlled-signal launcher semantics.
- Security/policy: the unprivileged Cortex API unit, narrowly scoped Oracle helper, signed helper responses, attachment trust boundary, canonical policy fragments, and worker-launch policy validation.
- Memory/operations: explicit contradiction/supersession edges, historical temporal visibility, source-unchanged owner-index gating, bounded AI OS evidence refresh, and a non-applying stale-job quarantine/recovery contract.
- Release/provenance: v2 release envelope/classification, exact-candidate qualification contracts, deploy/rollback/redeploy receipts, surface evidence validation, and supervisor-derived terminal state.

The preserved inference decisions are: PMHNP OAuth approved 2026-09-25, `gpt-5.6-sol`, default `xhigh`, provider-selected normal/default service tier with no paid-tier override, safe mode enabled, and external writes restricted. Source files name the approved OAuth policy but contain no credential and do not claim to verify the provisioned human account.

## Rejected or deliberately excluded changes

- Rejected the security patch's edits that changed `SEC-1`, `POLICY-1`, `POLICY-2`, and `SEC-2` in `surface-matrix.json` from `red` to `candidate_repair_undeployed`. Source paths are not evidence receipts, and the required smoke is red. The authoritative matrix therefore remains unchanged and red.
- No secret-bearing archive member, benchmark-only change, unsafe archive entry, or parallel replacement primitive was accepted.
- Overlapping implementations were not applied side-by-side. Their behavior was reconciled into the existing canonical route gate, Oracle router/helper, release controller, and runtime-surface contract.

## Conflicts resolved deliberately

- `plugins/cortex-route-gate/index.ts`: kept route/subagent trust and deadline semantics, then merged the attachment boundary. External-write authorization is derived only from user text parts; text carried inside file/media parts is excluded. Existing safe-mode/write gates remain authoritative.
- Worker launcher: retained only `xhigh`, `gpt-5.6-sol`, the approved PMHNP policy identifier, and `provider_default_no_override`; service-tier overrides and superseded `ultra` are rejected before transport.
- Oracle: merged canonical health/freshness semantics with the authenticated helper path. Both local and VM helpers now avoid reflecting subprocess/provider output in HTTP failures; they expose only return code, output byte count, and SHA-256.
- Memory governance: changed winner projection to operate on the explicit conflict component, preventing an unrelated supporting fact from inheriting another claim's winner while preserving supersession history.
- `ops/release/runtime-surfaces.json`: produced one v2 union containing the Oracle helper, owner-index units, immutable/private classification, all focused functional surface IDs, and the release/promotion contract. Partial worker versions were not retained.
- Release controller: unified unit installation and rollback state, authenticated Oracle readiness, envelope integrity, receipt/artifact binding, and surface supervision. Stop order now quiesces running watchdog/owner-index services as well as their timers. A merge-introduced missing parenthesis in supervisor evidence indexing was corrected before the smoke.

Static integration checks before the smoke parsed all changed Python and JSON files, found no patch whitespace errors, and found no merge markers in changed sources.

## Exactly one focused integration smoke

The workspace had no existing repository venv. A temporary workspace-local venv was created with `--system-site-packages`; no package was installed. It was removed after the run. The smoke was invoked exactly once:

```text
.integration-venv/bin/python scripts/smoke-cortex-repair-integration.py
```

Overall exit: **1** after 4.727 seconds. The runner reported `safeMode=true`, `externalWrites=false`, and `deploymentPerformed=false`.

| Stage | Exit | Result |
|---|---:|---|
| routing/subagent trust | 0 | Passed in 1702 ms. Trusted delegation routed/persisted, forged or missing trust failed closed, and the ignored-AbortSignal deadline remained bounded. |
| memory lifecycle | 1 | Failed in 434 ms. MEM-2 and MEM-3 assertions completed before AIOS-1, but the AI OS adapter compile command returned JSON that was not an object; no complete memory/operations receipt was emitted and the later OPS-2-source assertion did not run. |
| health/parser | 1 | Failed in 10 ms before collection: `/usr/bin/python3.12: No module named pytest`. This is a missing dependency blocker; it was not installed. |
| least privilege/policy | 1 | Failed in 1862 ms. Static unit/policy assertions and the attachment-focused check completed first, but the selected worker-launcher test process exited 1 without a child diagnostic; the later Oracle-helper unittest selection did not run. Treat the entire stage as unqualified. |
| release contract | 0 | Passed in 821 ms, including release-envelope/runtime/supervisor fixtures and all 15 detached-notifier tests. |

The runner initially resolved the venv interpreter symlink for child commands, which exposed the host interpreter path in its receipt. The runner source was corrected afterward to preserve `sys.executable`; it was not rerun because the task permits exactly one focused smoke. This correction is therefore unverified by execution and does not alter the red verdict.

## Residual risks and blockers

- The required integration smoke is red in three of five stages. Missing `pytest`, the AI OS adapter output-shape mismatch, and the worker-launcher focused-test failure must be resolved and qualified on a future authorized candidate.
- `surface-matrix.json` remains entirely red by design. No source-only patch or this partial smoke is treated as promotion evidence.
- No recovered patch closes `BROWSER-1`. `OPS-2` supplies only a safe non-applying contract; fresh live inventory, approved exact targets, quarantine, and recovery evidence remain control-plane work.
- Least-privilege migration requires an operator-controlled SQLite-safe copy to the new graph and L22 paths, ownership changes, helper-token provisioning, policy-file merge, and legacy Oracle-listener retirement. The release controller validates the new paths but does not perform that migration. Its rollback contract restores the graph backup and prior environment but does not independently restore an L22 data preimage; this must be addressed before activation.
- The Oracle helper still runs as UID 0 for the existing root-owned approved OAuth profile, retains provider egress, and has one writable Oracle agent-profile bind for token refresh. The reduced mount/capability boundary lowers but does not remove that risk.
- Source checks cannot verify that the host actually uses the approved PMHNP OAuth account. That requires the credential-safe control-plane verification described in the migration runbook.
- No clean exact-candidate commit/tree, full-suite receipt, gateway manifest, immutable archive deployment, rollback/redeploy pair, live canary, remote accepted ref, or final supervisor-green receipt exists for this workspace.

## Readiness decision

The workspace contains the accepted, deliberately merged source candidate, but it is **not ready for control-plane integration or promotion**. It is suitable only for follow-up repair and requalification under a new authorized run. No deployment or completion is claimed.
