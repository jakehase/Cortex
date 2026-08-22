# Neuro-Symbolic Memory Substrate — Step 7 (Implemented)

## Objective
Implement controlled forgetting/compression so low-utility records can be archived and projection rows pruned, while retaining anchor knowledge and preserving merge-key integrity.

## Implemented artifacts
1. `config/neuro_symbolic_memory/step7_forgetting_compression_contract.json`
   - Defines utility scoring policy, retention rules, compression actions, and completion gates.

2. `scripts/nsm_step7_forgetting.py`
   - Implements:
     - utility scoring (`recency`, `salience`, `retrievability`, `anchor_bonus`, `superseded_penalty`)
     - protected-set policy (latest + anchor + active consolidated)
     - compression candidate selection by threshold
     - compression bundle emission (`data/neuro_symbolic_memory/stores/compressed/`)
     - canonical archive update (`lifecycle.status=archived`, revision bump)
     - projection pruning (episodic/semantic/symbolic/procedural JSONL stores)
     - index updates and merge-key integrity checks

3. Runtime artifacts
   - `artifacts/neuro_symbolic_memory/step7/compression_probe_latest.json`
   - `artifacts/neuro_symbolic_memory/step7/compression_probe_latest.md`
   - `state/neuro_symbolic_memory/step7_state.json`

## Integration guarantees
- **Step 8:** procedural compiler can prioritize retained records while using compressed bundles as fallback evidence.
- **Step 9:** novel-methods baseline includes compression/retention policy effects.
- **Step 10:** ablations can compare retrieval behavior pre/post compression.
- **Step 11/12:** publication + hardening can use deterministic compression probe schema and merge-key integrity checks.

## Completion gate criteria
- utility scoring pass
- retention policy pass
- compression pass
- merge keys preserved pass
- audit log pass
