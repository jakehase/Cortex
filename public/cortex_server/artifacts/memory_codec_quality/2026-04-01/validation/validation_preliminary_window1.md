# Preliminary validation during durability window 1

Executed exact validation command block once during foreground window 1:

1. `pytest -q tests/test_cortex_codec.py tests/test_codec_policy.py tests/test_nexus_codec_integration.py tests/test_oracle_codec_integration.py`
   - result: `79 passed in 5.93s`
2. `pytest -q tests/test_cortex_kernel_v2.py tests/test_nexus_codec_integration.py`
   - result: `30 passed in 2.07s`
3. `pytest -q tests/test_cortex_codec.py tests/test_codec_policy.py tests/test_nexus_codec_integration.py tests/test_oracle_codec_integration.py tests/test_cortex_kernel_v2.py`
   - result: `88 passed in 5.28s`

These exact commands will be rerun after the final rerun so the final validation summary is post-durability and post-final-config, but the preliminary pass is already clean.
