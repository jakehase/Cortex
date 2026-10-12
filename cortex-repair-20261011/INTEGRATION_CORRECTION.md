# Cortex Post-Audit Repair 2026-10-11 — Integration Correction

Correction date: 2026-10-12  
Workspace: `/home/jake/clawd-remote/cortex-repair-20261011`  
Scope: source and focused-qualification blockers from `INTEGRATION_REVIEW.md` only

## Verdict

**PASS for the bounded source correction and its one focused integration smoke.** All six corrected focused stages passed with exit 0. The corrected runner used the workspace-local venv interpreter, verified every pinned dependency, retained safe mode, disabled external writes, and emitted a complete v2 machine receipt.

**The overall Cortex repair candidate is still not ready for deployment, promotion, or a completion claim.** This run did not perform the required control-plane migration, full exact-candidate remote qualification, deployment, rollback/redeploy proof, live canary, accepted-ref publication, or final supervisor gate. `surface-matrix.json` remains unchanged and red.

## Root causes and corrections

### AI OS memory/operations stage

The AI OS CLI successfully persisted its compile proof and compiled job, but the adapter's nested `spawnSync` result could carry `error=EPERM`, `status=0`, and empty stdout in the qualification sandbox. The adapter parsed that empty stdout as `null`; the Python smoke correctly rejected the non-object rather than weakening its assertion.

The adapter now consumes the CLI's supported durable packet contract for compile, boot, run, and claim. It requires the expected command and packet type, exact artifact root, successful status, and command-specific invariants. Compile additionally requires exactly one bounded regular job file and the complete internal-only boundary: no external writes, no external transport effect, no runtime replacement, no provider grant, and internal-artifact-only output. The smoke independently asserts that exact boundary and the `durable-packet` output contract.

### Health/parser stage

The prior runner bypassed the venv through interpreter resolution, then reached `/usr/bin/python3.12`, where `pytest` was absent. The corrected runner preserves `sys.executable` verbatim for Python stages and exports the same path to the Oracle selection.

An isolated `.integration-venv` was created in the workspace. `requirements-integration-correction.txt` pins the complete focused-test dependency set with exact versions. Network installation was unavailable, so `provision-focused-integration-venv.py` copied only recorded files from matching exact distributions in `/home/jake/cortex-venv/lib/python3.12/site-packages` into the local venv. It refused version mismatches and out-of-bound paths and emitted `integration-correction-dependencies.json` with per-distribution content-set hashes. No system package was installed or modified.

At smoke startup the runner verified that its prefix was exactly `.integration-venv`, compared every installed distribution to the repository pins, and recorded no mismatch. `pytest 9.1.1` and `pymupdf 1.28.0` were present; the health/parser selection passed 7 tests with 12 non-failing deprecation warnings.

### Least privilege/policy stage

The selected worker-launcher test depended on nested OS process spawning for both the launcher and fake SSH transport. The sandbox first caused the fake transport to time out while draining stdin and then exposed `spawnSync ... EPERM`. The production launcher correctly treated that error as a failed preflight, but the test could not reach the ordered-result assertion.

The launcher CLI is now factored through `runCli`, with dependency injection limited to tests. The focused tests use a deterministic in-process SSH transport while exercising the same admission checks, JSONL ordering, result persistence, source hashes, file modes, and completion-handoff binding. The production entry point still uses the real `spawnSync` transport and retains fail-closed handling for transport errors.

The policy smoke now requires `CORTEX_PYTHON` from the integration runner and uses it for the three focused Oracle-helper unittest methods. The selected launcher checks, attachment check, and all three Oracle methods ran and passed.

### BROWSER-1 source coverage

The integration review had no focused BROWSER-1 stage. The bridge now limits its Cortex base URL to a credential-free loopback HTTP origin, bounds attempts to 1–3 (default 2), retries only transient/network failures, and returns an explicit unattempted fallback contract after exhaustion. It never performs a generic-web fallback itself.

The new focused test uses only stubbed `fetch` responses and synthetic URLs. It covers status metadata, parsed search results, exact-page text handling, exact-page routing only through the local Cortex endpoint, two-attempt exhaustion, fallback signaling, and rejection of non-loopback bridge egress before any fetch or credential use. No external website or live credential was called.

### Integration receipt

The runner retains `sys.executable` without resolving its venv symlink, records the exact Python environment and dependency-lock digest, runs all stages even if one fails, and records each stage's command, status, exit code, duration, timeout flag, stdout/stderr byte count, SHA-256, and text. It atomically writes a mode-0600 receipt with safe-mode, external-write, deployment, scope, and truth-boundary fields.

## Changed paths

- `.gitignore` — ignores the workspace-local `.integration-venv`.
- `scripts/aios-adapter.mjs` — validates and returns durable AI OS command packets.
- `scripts/smoke-cortex-memory-ops-repair.py` — asserts the exact compile packet and internal-only boundary.
- `cortex-repair-20261011/requirements-integration-correction.txt` — exact focused-test dependency lock.
- `scripts/provision-focused-integration-venv.py` — bounded offline exact-distribution copier and receipt writer.
- `cortex-repair-20261011/integration-correction-dependencies.json` — dependency provisioning receipt.
- `scripts/codex-worker-launcher.mjs` — testable `runCli` boundary while preserving the production transport.
- `scripts/codex-worker-launcher.test.mjs` — deterministic transport and failure diagnostics.
- `scripts/smoke-cortex-security-policy.mjs` — preserved Python interpreter for Oracle unittest selection.
- `plugins/cortex-browser-bridge/index.ts` — loopback egress, bounded retry, and explicit fallback contract.
- `plugins/cortex-browser-bridge/openclaw.plugin.json` — bounded `maxAttempts` configuration.
- `plugins/cortex-browser-bridge/index.test.mjs` — existing focused expectations updated for bounded attempts and loopback.
- `plugins/cortex-browser-bridge/browser-reliability.test.mjs` — BROWSER-1 focused source coverage.
- `scripts/smoke-cortex-repair-integration.py` — preserved interpreter, browser stage, dependency gate, and v2 receipt.
- `cortex-repair-20261011/integration-correction-smoke-receipt.json` — complete focused-smoke receipt.
- `cortex-repair-20261011/INTEGRATION_CORRECTION.md` — this correction report.

No `surface-matrix.json` row was modified.

## Exactly one corrected focused integration smoke

Exact command, invoked once:

```text
.integration-venv/bin/python scripts/smoke-cortex-repair-integration.py --receipt cortex-repair-20261011/integration-correction-smoke-receipt.json
```

Overall result: **exit 0**, `status=passed`, 5,516 ms. The receipt reports `safeMode=true`, `externalWrites=false`, `deploymentPerformed=false`, `workspaceLocalVenv=true`, and zero dependency mismatches.

| Stage | Exit | Duration | Result |
|---|---:|---:|---|
| routing-and-subagent-trust | 0 | 1,727 ms | Passed trusted delegation, forged/missing-trust rejection, persistence, and bounded failure checks. |
| memory-lifecycle | 0 | 656 ms | Passed MEM-2, MEM-3, AIOS-1 durable/internal-only evidence refresh, and the OPS-2 source contract. |
| health-and-parser | 0 | 1,217 ms | Passed 7 focused tests; 12 deprecation warnings were non-failing. |
| least-privilege-and-policy | 0 | 991 ms | Passed static policy/unit checks, attachment selection, worker-launcher selection, and 3 Oracle-helper tests. |
| browser-reliability | 0 | 94 ms | Passed status, search, exact-page, bounded retry/fallback, and loopback-egress coverage with stubbed fetch only. |
| release-contract | 0 | 825 ms | Passed release fixtures and all 15 detached-notifier tests. |

Machine receipts:

- `cortex-repair-20261011/integration-correction-smoke-receipt.json`: SHA-256 `57b2ad7f467a0d9fd6a7132a6b057610c339c4a10e90343e535bc2257bb2ff0e`, mode `0600`.
- `cortex-repair-20261011/integration-correction-dependencies.json`: SHA-256 `1810c7836aba2e40ceab11575d1a1b9ee555b93112fd62abb8c8e5156947a337`, mode `0600`.
- `cortex-repair-20261011/requirements-integration-correction.txt`: SHA-256 `98da082c076f0bb76b3f89f6994ff3710ef638bd8d1de51a6b18b4a82543732a`.

No full suite was run.

## Unresolved control-plane and promotion work

- The authoritative surface matrix remains entirely red because source plus one focused smoke is not deployment evidence.
- BROWSER-1 still needs exact-candidate deployment and a controlled live status/search/exact-page observation under the approved egress configuration; this source test intentionally used no website or credential.
- OPS-2 still needs fresh live inventory, approved exact stale-job targets, operator-controlled disable/quarantine actions, and recovery evidence. The source contract continues to authorize no live mutation and protects active reminders.
- Least-privilege activation still requires the operator-controlled SQLite-safe graph/L22 copy, ownership changes, helper-token provisioning, policy-file merge, legacy Oracle-listener retirement, and an L22 rollback preimage.
- The Oracle helper remains a root boundary for the existing approved OAuth profile, with provider egress and one writable agent-profile bind for token refresh. Source checks do not verify the provisioned human account; credential-safe control-plane verification of the approved PMHNP OAuth identity is still required.
- A clean exact-candidate commit/tree, one clean full remote suite, gateway/code manifest, immutable release, deployment hash parity, rollback/redeploy pair, live canary, authoritative remote accepted ref, and final supervisor-green receipt do not yet exist.

No live service, credential, database, timer, OpenClaw configuration, deployment target, or remote ref was read or changed by this correction.
