# Window 1 regression checks

Foreground checks completed while durability run 1 was active:

1. Relevant Cortex/Nexus/Oracle subset
   - command: `pytest -q tests/test_codec_policy.py tests/test_cortex_codec.py tests/test_cortex_kernel_v2.py tests/test_nexus_assurance_contract.py tests/test_nexus_auto_levels.py tests/test_nexus_autotune.py tests/test_nexus_brainstorm_natural_intent.py tests/test_nexus_codec_integration.py tests/test_nexus_fastlane_integration.py tests/test_nexus_forced_chains.py tests/test_nexus_kernel_v2_integration.py tests/test_nexus_memory_commit.py tests/test_nexus_world_grounding.py tests/test_oracle_autopilot_command.py tests/test_oracle_codec_integration.py tests/test_oracle_kernel_v2_integration.py tests/test_oracle_micro_fastpath.py`
   - result: `125 passed in 28.33s`

2. Broad repo suite
   - command: `pytest -q tests`
   - result: `457 passed in 67.35s`

These runs will be folded into the final validation summary after the post-durability rerun is complete.
