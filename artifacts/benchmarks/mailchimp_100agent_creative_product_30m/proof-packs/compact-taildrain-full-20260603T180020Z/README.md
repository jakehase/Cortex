# Mailchimp compact taildrain full proof pack — 2026-06-03T18:00:20Z

## Status

This run is a **scored benchmark pass**:

- `thresholdPass=true`
- `mechanicalGreen=true`
- `scaleProofReady=true`
- `thresholdFailures=[]`
- `blocker=null`

Truth boundary: this proves the scoped `mailchimp_100agent_creative_product_30m` benchmark. It is **not** a full Mailchimp clone completion claim.

## Execution boundary

The benchmark worker farm ran on the Hetzner VPS:

- Execution plane: `jake@37.27.129.239` / `clawd-exec-hel1`
- Remote artifact root: `/home/jake/clawd-remote/large-project-capability-stack/artifacts/benchmarks/mailchimp_100agent_creative_product_30m/creative-compact-taildrain-full-20260603T180020Z`
- Local/OpenClaw role: control plane only — patching, launch, monitoring, artifact reads, and proof-pack writing.

Final remote process check found no active benchmark runner, `codex-creative-worker`, or Codex worker processes.

## Canonical result

- Run id: `mailchimp_100agent_creative_product_30m-compact-taildrain-full-20260603T180020Z`
- Source contract: `/home/jake/clawd-remote/large-project-capability-stack/artifacts/benchmarks/mailchimp_100agent_creative_product_30m/creative-100real-promotionfix-10slot-full-20260603-034718/run_contract.json`
- Shards: `100`
- Merged: `100`
- Rejected: `0`
- Elapsed: `31.2m`
- Peak concurrency: `100`
- Tokens observed: `1,538,888`
- Calls: `105 started / 105 completed`
- `globalStop=null`

## Creative/product evidence

- OK surfaces: `100`
- Missing/failed surfaces: `0`
- Creative worker evidence integrity: `1`
- Creative iteration integrity: `1`
- Creative product delta integrity: `1`
- Template fallback rate: `0`

## Readiness and verifier spotcheck

Prelaunch readiness for this exact root passed:

- `ok=true`
- failed checks: `0`
- surface count: `100`

Campaign-ops verifier spotcheck passed 4/4 after fixing broad alias overmatch. `campaign_ops_*` surfaces used `tests/campaign-ops.test.mjs` plus their no-generic-shim verifier, not unrelated campaign sibling tests.

## Fix between red and green

Prior root `creative-compact-taildrain-full-20260603T171906Z` ended red at 96/100. The four rejects were `campaign_ops_*#1`; their creative evidence was `ok=true`, but verifier targeting overmatched the generic alias `campaign` and admitted unrelated sibling verifiers.

The fix ignores broad one-word family aliases when a more specific alias exists, and adds regression coverage for `campaign_ops_api` not overmatching `campaign-briefs`.

## Artifact hashes

```text
454417a21819161fc795a48bec8dc2f37f67644dcb77b252d99b7fb8a558ef0e  orchestrator_summary.json
d8e9e472c3735229dd465c334880ad0db879b2e8222f9026d7791654e08baeb6  completion_summary.json
fddcbf6daccb104f1f115920609c37b9e431250ec8fbb2f565f4a75f865df79c  creative_worker_evidence.json
b6e4343619a0b2c5247c3a5911c42e61741cd2925555f50590eaa339aa93bb2a  orchestrator_run/results/creative-worker-budget-ledger.json
b625e915cfff6cda181ed34a50a3bb410835b2c7295176ada8118e395e99c9f7  orchestrator_run/patch_queue.json
41b0434dfb0c1615bf15a53d6f024e67fe812ad93ce29d26efa1c6f6f5b4875c  readiness.json
3130db803c528290ac23a43f796c6f7e793e17decc9d18467c3df829e2d66474  verifier-spotcheck.json
```

See `summary.json` for the machine-readable version.
