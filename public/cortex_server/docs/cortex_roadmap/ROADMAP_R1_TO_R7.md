# Cortex Remaining Breakthroughs Roadmap (R1-R7)

This pack operationalizes the remaining seven breakthroughs after R8 (neuro-symbolic memory substrate) completion.

> Extension: R9 (Adaptive Routing Brain) is now scaffolded as a post-R8 multiplier track in `docs/cortex_roadmap/R9_ADAPTIVE_ROUTING_BRAIN.md`.

## Sequence
- Phase A: R6, R4, R1, R3
- Phase B: R2, R7
- Phase C: R5

## Pack files
- **R1** Unified self-updating world model: `config/cortex_roadmap/r1_unified_world_model_contract.json`, `scripts/cortex_r1_unified_world_model.py`, `docs/cortex_roadmap/R1_UNIFIED_WORLD_MODEL.md`
- **R2** Lifelong plasticity without forgetting: `config/cortex_roadmap/r2_lifelong_plasticity_contract.json`, `scripts/cortex_r2_lifelong_plasticity.py`, `docs/cortex_roadmap/R2_LIFELONG_PLASTICITY.md`
- **R3** Neuromodulation layer: `config/cortex_roadmap/r3_neuromodulation_layer_contract.json`, `scripts/cortex_r3_neuromodulation_layer.py`, `docs/cortex_roadmap/R3_NEUROMODULATION_LAYER.md`
- **R4** Global workspace + local specialists: `config/cortex_roadmap/r4_global_workspace_contract.json`, `scripts/cortex_r4_global_workspace.py`, `docs/cortex_roadmap/R4_GLOBAL_WORKSPACE.md`
- **R5** Grounded embodiment loop: `config/cortex_roadmap/r5_grounded_embodiment_contract.json`, `scripts/cortex_r5_grounded_embodiment.py`, `docs/cortex_roadmap/R5_GROUNDED_EMBODIMENT.md`
- **R6** Metacognitive truth engine: `config/cortex_roadmap/r6_metacognitive_truth_engine_contract.json`, `scripts/cortex_r6_metacognitive_truth_engine.py`, `docs/cortex_roadmap/R6_METACOGNITIVE_TRUTH_ENGINE.md`
- **R7** Value/homeostasis architecture: `config/cortex_roadmap/r7_value_homeostasis_contract.json`, `scripts/cortex_r7_value_homeostasis.py`, `docs/cortex_roadmap/R7_VALUE_HOMEOSTASIS.md`
- **R9** Adaptive routing brain: `config/cortex_roadmap/r9_adaptive_routing_brain_contract.json`, `scripts/cortex_r9_adaptive_routing_brain.py`, `docs/cortex_roadmap/R9_ADAPTIVE_ROUTING_BRAIN.md`

## Execute all
```bash
for s in /root/.openclaw/workspace/scripts/cortex_r*_*.py; do python3 "$s"; done
```
