# Neuro-Symbolic Memory Substrate — Step 5 (Implemented)

## Objective
Implement the hybrid retrieval engine that routes queries across all four memory planes, fuses evidence by stable IDs, and runs contradiction checks before returning retrieval output.

## Implemented artifacts
1. `config/neuro_symbolic_memory/step5_hybrid_retrieval_contract.json`
   - Defines query-routing, fusion, contradiction-check, and completion-gate requirements.

2. `scripts/nsm_step5_retrieval.py`
   - Implements:
     - query router (episodic/semantic/symbolic/procedural weighting)
     - per-plane retrieval from Step 3 substrate stores
     - fused ranking by `memory_id`/`lineage_id` with plane scores
     - contradiction checks over fused evidence
     - integration-key preservation checks
     - probe artifact + state emission

3. Runtime artifacts
   - `artifacts/neuro_symbolic_memory/step5/retrieval_probe_latest.json`
   - `artifacts/neuro_symbolic_memory/step5/retrieval_probe_latest.md`
   - `state/neuro_symbolic_memory/step5_state.json`

## Integration guarantees
- **Step 1:** metric anchors retained in retrieved records (`metric_anchor_ids`).
- **Step 2:** retrieval works over records conforming to `nsm_memory_record_v1`.
- **Step 3:** reads canonical + projection stores and rejoins on stable IDs.
- **Step 4:** consumes newly ingested records without remapping.
- **Step 6+ readiness:** retrieval report includes fused evidence and contradiction outputs usable by consolidation, compression, procedural compilation, and ablations.

## Completion gate criteria
- query router pass
- fusion pass
- contradiction check pass
- integration keys preserved pass
