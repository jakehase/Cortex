# Neuro-Symbolic Memory Substrate — Step 6 (Implemented)

## Objective
Implement the consolidation sleep-pass that merges related memory records into revisioned consolidated records while preserving lineage links, merge keys, and supersedes chains.

## Implemented artifacts
1. `config/neuro_symbolic_memory/step6_consolidation_contract.json`
   - Defines candidate selection, merge requirements, revision policy, and completion gates.

2. `scripts/nsm_step6_consolidation.py`
   - Implements:
     - candidate selection via semantic/episodic overlap + recency fallback
     - multi-plane merge (`episode`, `semantic`, `symbolic`, `procedural`)
     - revisioned consolidated record with `lifecycle.supersedes`
     - Step 2 schema validation (`validate_record`)
     - Step 3 substrate write/readback verification
     - gate artifact + state emission

3. Runtime artifacts
   - `artifacts/neuro_symbolic_memory/step6/consolidated_record_latest.json`
   - `artifacts/neuro_symbolic_memory/step6/consolidation_probe_latest.json`
   - `artifacts/neuro_symbolic_memory/step6/consolidation_probe_latest.md`
   - `state/neuro_symbolic_memory/step6_state.json`

## Integration guarantees
- **Step 7 readiness:** supersedes chain + revision metadata available for compression/retention logic.
- **Step 8 readiness:** merged procedure candidates and trace refs available.
- **Step 9+ readiness:** deterministic consolidation report schema supports ablations/publication/hardening.

## Completion gate criteria
- candidate selection pass
- schema validation pass
- supersedes linkage pass
- substrate write pass
- roundtrip pass
- merge keys preserved pass
