# R9 Adaptive Routing Brain Artifacts

This directory holds reproducible local bootstrap artifacts for the routing roadmap slice.

Generate/update them with:
- `python3 scripts/cortex_r9_step1_baseline_telemetry.py`
- `python3 scripts/cortex_r9_step2_route_taxonomy.py`
- `python3 scripts/cortex_r9_step3_feature_pipeline.py`
- `python3 scripts/cortex_r9_step4_scoring_policy.py`
- `python3 scripts/cortex_r9_step5_candidate_generator.py`
- `python3 scripts/cortex_r9_step6_counterfactual_replay.py`
- `python3 scripts/cortex_r9_step7_safety_rollback.py`
- `python3 scripts/cortex_r9_step8_shadow_mode.py`
- `python3 scripts/cortex_r9_step9_canary_rollout.py`
- `python3 scripts/cortex_r9_step10_full_rollout_autotune.py`
- `python3 scripts/cortex_r9_adaptive_routing_brain.py`

These are bootstrap/offline artifacts, not proof of a live production rollout.
