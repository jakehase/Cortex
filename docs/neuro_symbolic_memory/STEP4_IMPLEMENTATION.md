# Neuro-Symbolic Memory Substrate — Step 4 (Implemented)

## Objective
Implement an ingestion + linking pipeline that transforms raw interaction events into unified NSM records, validates them, and writes them into the four-store substrate.

## Implemented artifacts
1. `config/neuro_symbolic_memory/step4_ingestion_linking_contract.json`
   - Defines stage-by-stage pipeline, integration requirements, and completion gates.

2. `scripts/nsm_step4_ingestion.py`
   - Pipeline stages implemented:
     1. normalize inbound event
     2. derive semantic features (summary + concepts)
     3. derive symbolic links (entities/relations/constraints)
     4. derive procedural candidates
     5. build unified record (`nsm_memory_record_v1`)
     6. validate via Step 2 validator (`validate_record`)
     7. write/link via Step 3 substrate (`FourStoreSubstrate`)
     8. verify index linkage + lossless roundtrip
     9. emit probe artifacts + state

3. Runtime artifacts
   - `artifacts/neuro_symbolic_memory/step4/ingested_record_latest.json`
   - `artifacts/neuro_symbolic_memory/step4/ingestion_probe_latest.json`
   - `artifacts/neuro_symbolic_memory/step4/ingestion_probe_latest.md`
   - `state/neuro_symbolic_memory/step4_state.json`

## Integration guarantees
- **Step 1 compatibility:** metric anchor IDs preserved in `integration.metric_anchor_ids`.
- **Step 2 compatibility:** record is validated against unified schema before write.
- **Step 3 compatibility:** write/read and projection paths use the existing four-store substrate.
- **Step 5+ compatibility:** stable merge keys and lineage IDs are preserved for retrieval, consolidation, procedural compilation, and ablation workflows.

## Completion gate criteria
- schema valid
- relation integrity passes
- substrate write succeeds
- lossless roundtrip passes
- index linkage confirmed
