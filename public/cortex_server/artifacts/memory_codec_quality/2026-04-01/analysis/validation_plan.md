# Validation plan

Planned exact validation commands:

1. `pytest -q tests/test_cortex_codec.py tests/test_codec_policy.py tests/test_nexus_codec_integration.py tests/test_oracle_codec_integration.py`
2. `pytest -q tests/test_cortex_kernel_v2.py tests/test_nexus_codec_integration.py`
3. `pytest -q tests/test_cortex_codec.py tests/test_codec_policy.py tests/test_nexus_codec_integration.py tests/test_oracle_codec_integration.py tests/test_cortex_kernel_v2.py`

Why these suites:
- focused codec/module coverage
- runtime/kernel prompt-assembly coverage
- broader relevant surface without unrelated repo churn
