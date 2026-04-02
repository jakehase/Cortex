#!/usr/bin/env bash
set -euo pipefail
cd /root/clawd/public/cortex_server
python3 scripts/run_memory_codec_quality_benchmark.py run \
  --corpus benchmarks/cortex_memory_codec_quality_corpus_2026-04-01.json \
  --output artifacts/memory_codec_quality/2026-04-01/final/final.memory_codec.json \
  --config-name cfg_balanced_roomy \
  --max-items-per-bucket 8 \
  --packet-chars 420 \
  --codec-globals-json artifacts/memory_codec_quality/2026-04-01/final/final_codec_globals.json
