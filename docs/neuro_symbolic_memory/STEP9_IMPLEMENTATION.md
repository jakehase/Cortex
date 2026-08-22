# Neuro-Symbolic Memory Substrate — Step 9 (Implemented)

## Objective
Implement and evaluate novel-method prototypes (BCN, CRS, PGD) and persist results in both artifact form and validated substrate memory records.

## Implemented artifacts
1. `config/neuro_symbolic_memory/step9_novel_methods_contract.json`
   - Defines required method outputs, integration guarantees, and completion gates.

2. `scripts/nsm_step9_novel_methods.py`
   - Implements:
     - **BCN** (Bilateral Consolidation Networks): bidirectional consolidation links between related memory records
     - **CRS** (Counterfactual Replay Scheduler): replay priority schedule with counterfactual prompts
     - **PGD** (Procedural Graph Distillation): directed action graph + distilled procedural playbooks
   - Validates compiled Step 9 record with Step 2 validator and writes it via Step 3 substrate.

3. Runtime artifacts
   - `artifacts/neuro_symbolic_memory/step9/novel_methods_output_latest.json`
   - `artifacts/neuro_symbolic_memory/step9/novel_methods_probe_latest.json`
   - `artifacts/neuro_symbolic_memory/step9/novel_methods_probe_latest.md`
   - `state/neuro_symbolic_memory/step9_state.json`

4. Research store artifact
   - `data/neuro_symbolic_memory/stores/research/step9_novel_methods_latest.json`

## Integration guarantees
- **Step 10:** ablations can benchmark against method scores/counts and replay the same outputs.
- **Step 11:** publication packaging can consume deterministic method artifacts and probe schema.
- **Step 12:** hardening can monitor method drift and gate integrity on each run.

## Completion gate criteria
- source collection pass
- bcn pass
- crs pass
- pgd pass
- schema validation pass
- substrate write pass
- integration keys preserved pass
