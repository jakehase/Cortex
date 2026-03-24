# Neuro-Symbolic Memory Substrate — Step 8 (Implemented)

## Objective
Implement a procedural memory compiler that transforms raw procedure traces/candidates from retained records into reusable compiled procedures.

## Implemented artifacts
1. `config/neuro_symbolic_memory/step8_procedural_compiler_contract.json`
   - Defines source requirements, compilation requirements, integration guarantees, and completion gates.

2. `scripts/nsm_step8_procedural_compiler.py`
   - Implements:
     - source collection from active canonical records + trace refs + compressed-bundle fallback context
     - clustering/dedup of raw procedure candidates
     - compiled procedure synthesis (merged steps/preconditions/postconditions/support metadata)
     - Step 2 schema validation for compiled substrate record
     - Step 3 substrate write/readback verification
     - deterministic probe + state artifacts

3. Runtime artifacts
   - `artifacts/neuro_symbolic_memory/step8/compiled_record_latest.json`
   - `artifacts/neuro_symbolic_memory/step8/procedural_compiler_probe_latest.json`
   - `artifacts/neuro_symbolic_memory/step8/procedural_compiler_probe_latest.md`
   - `state/neuro_symbolic_memory/step8_state.json`

4. Procedural store artifact
   - `data/neuro_symbolic_memory/stores/procedural/compiled_procedures_latest.json`

## Integration guarantees
- **Step 9:** novel methods can benchmark against compiled-procedure baseline and support counts.
- **Step 10:** ablations can compare pre/post-compiler execution quality.
- **Step 11:** publication layer can cite deterministic compile statistics and algorithm.
- **Step 12:** hardening can monitor procedure drift and compile consistency over time.

## Completion gate criteria
- source collection pass
- compilation pass
- schema validation pass
- substrate write pass
- integration keys preserved pass
