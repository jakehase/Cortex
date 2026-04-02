#!/usr/bin/env bash
set -euo pipefail
cd /root/clawd/public/cortex_server
pytest -q tests/test_cortex_codec.py tests/test_codec_policy.py tests/test_nexus_codec_integration.py tests/test_oracle_codec_integration.py
pytest -q tests/test_cortex_kernel_v2.py tests/test_nexus_codec_integration.py
pytest -q tests/test_cortex_codec.py tests/test_codec_policy.py tests/test_nexus_codec_integration.py tests/test_oracle_codec_integration.py tests/test_cortex_kernel_v2.py
