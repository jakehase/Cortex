# Neuro-Symbolic Memory Substrate — Step 3 (Implemented)

## Objective
Implement the four-store substrate and guarantee that unified records are persisted **losslessly** (no field drops), while exposing projections needed by later steps.

## Implemented artifacts
1. `config/neuro_symbolic_memory/step3_store_substrate_contract.json`
   - Defines store topology, integration invariants, and Step 3 completion gates.

2. `scripts/nsm_step3_stores.py`
   - Implements storage + probe harness for:
     - canonical store (`canonical/records/*.json`)
     - episodic projection (`episodic/events.jsonl`)
     - semantic projection (`semantic/concepts.jsonl`)
     - symbolic projections (`symbolic/entities.jsonl`, `symbolic/relations.jsonl`, `symbolic/constraints.jsonl`)
     - procedural projection (`procedural/procedures.jsonl`)
     - index pointers (`index/memory_index.json`)
   - Performs roundtrip readback checks and lossy-field detection.

3. Runtime artifacts
   - `artifacts/neuro_symbolic_memory/step3/store_probe_latest.json`
   - `artifacts/neuro_symbolic_memory/step3/store_probe_latest.md`
   - `state/neuro_symbolic_memory/step3_state.json`

## Integration design (why this composes with later steps)
- **Step 4 ingestion** can write one unified record and rely on deterministic plane projections.
- **Step 5 retrieval** can join canonical + plane projections via stable IDs (`memory_id`, `lineage_id`, `revision`, `updated_at_utc`).
- **Step 6/7 consolidation & forgetting** can supersede canonical entries while preserving lineage and merge keys.
- **Step 8 procedural compiler** writes directly into procedural projections.
- **Step 9–12 novel methods, ablations, and hardening** can benchmark replay behavior against stable index pointers and digests.

## Completion gate criteria
- Lossless canonical roundtrip required (no field drop).
- Projection writes must materialize for episodic/semantic/symbolic/procedural planes.
- Gate result reported in `store_probe_latest.json`.
