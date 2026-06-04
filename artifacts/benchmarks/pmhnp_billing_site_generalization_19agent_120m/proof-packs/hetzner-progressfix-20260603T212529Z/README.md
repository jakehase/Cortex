# PMHNP billing-site generalization proof pack — 19-agent/120m pass

## Status

This run is a scored PMHNP billing-site generalization pass at the honest current repository scale:

- `thresholdPass=true`
- `mechanicalGreen=true`
- `scaleProofReady=true`
- `thresholdFailures=[]`
- `blocker=null`

Truth boundary: this proves **19 agents / 19 low-overlap surfaces / 120 minutes**. It does **not** claim the old 25-surface PMHNP contract is still valid.

## Execution boundary

- Execution plane: Hetzner VPS `jake@37.27.129.239`
- Local/OpenClaw role: control plane only — patching, launch, monitoring, artifact reads, proof-pack writing
- Remote artifact root: `/home/jake/clawd-remote/large-project-capability-stack/artifacts/benchmarks/pmhnp_billing_site_generalization_19agent_120m/hetzner-progressfix-20260603T212529Z`

Final process check found no active benchmark runner or PMHNP verifier processes.

## Canonical result

- Run id: `pmhnp_billing_site_generalization_19agent_120m-hetzner-rerun-20260603T212529Z`
- Shards: `19`
- Merged: `19`
- Rejected: `0`
- Peak concurrency: `19`
- Elapsed: `120.14m`
- Duration target: `120m`, met
- Median minutes to meaningful progress: `0`
- Transfer evidence: 19 total / 19 verified / 19 productive
- Transfer score: `1`

## Important caveat

A fresh 25-surface prelaunch root found only 19/25 currently passing PMHNP billing-site surfaces. Six old site/blog surfaces had stale or too-short content. That root was blocked honestly instead of launched:

`/home/jake/clawd-remote/large-project-capability-stack/artifacts/benchmarks/pmhnp_billing_site_generalization_25agent_240m/hetzner-rerun-20260603T185452Z/prelaunch_blocker.json`

## Patch that made the pass possible

Local commit `d8e1f7a20` (`Preserve early transfer progress evidence`) fixed the prior red result by preserving `firstMeaningfulProgressMs=0` through verifier/worker wrappers and counting deterministic product-diff implementation progress in threshold evaluation.

## Artifact hashes

```text
25a0ff989a8c262e3121499b62a34169641f932c6d4b922acfce54795acea666  orchestrator_summary.json
9d0fcccf8fb3eafb0bb1074ffb41dce30b2e15fc001187f12209892570262fb0  completion_summary.json
1e97ca037605fea32cfac88714dadb95d88f4d1fe9fb8ecc196f3a91ba382867  threshold_evaluation.json
5c021dddd25063885e99d664097d400da0f77b1b12fd95ef705df7fedf4b5d60  transfer_evidence.json
627d0b53465b3c84a11732c1eadd208da2fafbc02c0268e662fbe6c57e534285  orchestrator_run/patch_queue.json
d961ca6508ed7848acb3aabf9ea0afc355dc24ea720baf1e56d197aed2a964a2  prelaunch-spotcheck.json
```

See `summary.json` for the machine-readable proof pack.
