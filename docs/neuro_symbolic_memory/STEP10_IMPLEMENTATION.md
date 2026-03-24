# Neuro-Symbolic Memory Substrate — Step 10 (Implemented)

## Objective
Build a deterministic ablation harness that compares the Step 8 baseline against Step 9 novel-method combinations (BCN/CRS/PGD), quantifies method deltas, and writes a validated Step 10 record to substrate.

## Implemented artifacts
1. `config/neuro_symbolic_memory/step10_ablation_harness_contract.json`
   - Defines required ablation variants, required deltas, deterministic recompute requirement, and completion gate.

2. `scripts/nsm_step10_ablation_harness.py`
   - Loads Step 1/8/9 artifacts.
   - Computes deterministic ablation matrix variants:
     - `step8_baseline`
     - `full_bcn_crs_pgd`
     - `minus_bcn`, `minus_crs`, `minus_pgd`
     - `bcn_only`, `crs_only`, `pgd_only`
   - Produces marginal contributions and digest-based reproducibility check.
   - Validates compiled Step 10 record using Step 2 validator and writes via Step 3 substrate.
   - Runs Step 5 retrieval regression smoke test.

3. Runtime artifacts
   - `artifacts/neuro_symbolic_memory/step10/ablation_matrix_latest.json`
   - `artifacts/neuro_symbolic_memory/step10/ablation_probe_latest.json`
   - `artifacts/neuro_symbolic_memory/step10/ablation_probe_latest.md`
   - `artifacts/neuro_symbolic_memory/step10/ablation_record_latest.json`
   - `state/neuro_symbolic_memory/step10_state.json`

4. Research store artifact
   - `data/neuro_symbolic_memory/stores/research/step10_ablation_latest.json`

## Integration guarantees
- **Step 11:** publication package can consume deterministic ablation matrix + digest + contribution table.
- **Step 12:** hardening can run the same harness on cadence and alert on contribution drift/regressions.

## Completion gate criteria
- source collection pass
- ablation matrix pass
- method delta pass
- reproducibility pass
- schema validation pass
- substrate write pass
- integration keys preserved pass
- retrieval regression pass
