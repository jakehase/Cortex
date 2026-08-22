# CORTEX Memory/Codec Quality Final Report — 2026-04-01

> Draft in progress during durability windows. Finalized after durability runs, final rerun, and validation.

## 1. Stage checklist
- corpus: complete (44 cases)
- baseline: complete
- experiments: complete (8 configs)
- triage queue: complete (20 clusters)
- tuning loop A: complete
- tuning loop B: complete
- durability run 1: complete
- foreground window 1: complete
- durability run 2: complete
- foreground window 2: complete
- durability run 3: complete
- foreground window 3: complete
- final rerun: complete
- validation: complete
- final report: complete

## 2. Corpus summary
- corpus artifact: `benchmarks/cortex_memory_codec_quality_corpus_2026-04-01.json`
- case_count: 44
- categories: active_project_continuity, codec_harmful, codec_helpful, cross_turn_followup, explanation_memory_used, false_memory_trap, long_sequence_durability, open_loop_continuity, preference_memory, preference_override, stale_memory_suppression

## 3. Baseline metrics
- overall_pass_rate: 0.341
- false_memory_rate: 0.659
- stale_memory_failure_rate: 0.114
- omission_rate: 0.045
- preference_recall_accuracy: 0.0
- open_loop_continuity_accuracy: 0.538
- avg_packet_chars: 98.114

## 4. Config matrix summary
- experiment_count: 8
- winner: cfg_balanced_roomy
- top configs:
  - cfg_balanced_roomy: pass=0.886 false=0.114 stale=0.0 avg_packet_chars=53.068 score=0.584
  - cfg_balanced_320: pass=0.886 false=0.114 stale=0.0 avg_packet_chars=53.068 score=0.584
  - cfg_balanced_280: pass=0.886 false=0.114 stale=0.0 avg_packet_chars=53.068 score=0.584
  - cfg_no_promotion: pass=0.886 false=0.114 stale=0.0 avg_packet_chars=53.068 score=0.584
  - cfg_goals_patterns_on: pass=0.841 false=0.159 stale=0.045 avg_packet_chars=62.773 score=0.557

## 5. Triage queue summary
- cluster_count: 20
- top clusters:
  - preference_memory::compression_ratio (count=45)
  - stale_memory_suppression::packet_unexpected (count=14)
  - preference_memory::active_projects::unexpected (count=5)
  - preference_override::packet_unexpected (count=5)
  - preference_override::preferences::unexpected (count=5)
  - active_project_continuity::active_projects::unexpected (count=5)
  - long_sequence_durability::packet_unexpected (count=5)
  - false_memory_trap::packet_unexpected (count=4)
  - false_memory_trap::active_projects::unexpected (count=4)
  - long_sequence_durability::preferences::unexpected (count=2)

## 6. Tuning loop A changes/results
- pass_rate: 0.773 (delta vs baseline 0.432)
- false_memory_rate: 0.227 (delta -0.432)
- key changes:
  - expanded preference phrase coverage
  - preference revision resolution for start replies / call me / prefer claims
  - project extraction filtering for generic tag and sentence noise

## 7. Tuning loop B changes/results
- pass_rate: 0.886 (delta vs loop A 0.113)
- false_memory_rate: 0.114 (delta -0.113)
- stale_memory_failure_rate: 0.0 (delta -0.114)
- key changes:
  - packet packing now favors promoted/fresh memory
  - stale packet items are suppressed by default
  - goals/patterns are emitted only when needed to explain fresh work

## 8. Durability run results
- run 1 complete: duration_seconds=1800 round_count=7782 avg_pass_rate=0.886 avg_false_memory_rate=0.114 avg_stale_memory_failure_rate=0.0
- run 2 complete: duration_seconds=1800 round_count=7780 avg_pass_rate=0.886 avg_false_memory_rate=0.114 avg_stale_memory_failure_rate=0.0
- run 3 complete: duration_seconds=2248 round_count=3177 avg_pass_rate=0.886 avg_false_memory_rate=0.114 avg_stale_memory_failure_rate=0.0

## 9. Foreground concurrent work during durability windows
Window 1 complete and summarized in `artifacts/memory_codec_quality/2026-04-01/foreground_window_1_summary.md`. Artifacts created during run 1:
- `artifacts/memory_codec_quality/2026-04-01/tuning_loop_a/loop_a_summary.md`
- `artifacts/memory_codec_quality/2026-04-01/tuning_loop_b/loop_b_summary.md`
- `artifacts/memory_codec_quality/2026-04-01/analysis/remaining_issues_after_loop_b.json`
- `artifacts/memory_codec_quality/2026-04-01/analysis/metric_progression.json`
- `artifacts/memory_codec_quality/2026-04-01/analysis/durability_window_1_checkpoint.md`

Window 2 complete and summarized in `artifacts/memory_codec_quality/2026-04-01/foreground_window_2_summary.md`. Window 3 complete and summarized in `artifacts/memory_codec_quality/2026-04-01/foreground_window_3_summary.md`.

## 10. Final benchmark results
- final rerun artifact: `artifacts/memory_codec_quality/2026-04-01/final/final.memory_codec.json`
- overall_pass_rate: 0.886
- false_memory_rate: 0.114
- stale_memory_failure_rate: 0.0
- omission_rate: 0.0
- preference_recall_accuracy: 0.5
- open_loop_continuity_accuracy: 1.0
- avg_packet_chars: 53.068

## 11. Before/after summary
- baseline overall_pass_rate: 0.341
- final overall_pass_rate: 0.886
- pass_rate_gain: 0.545
- false_memory_reduction: 0.545
- stale_memory_failure_reduction: 0.114

## 12. Remaining weaknesses
- The remaining benchmark misses are the five tiny single-preference compression-ratio cases where cold-packet label overhead exceeds the raw source length.
- Those misses are not continuity or false-memory failures; they are a packet-format efficiency tradeoff on extremely short one-item memories.

## 13. Recommended defaults
- keep preference revision resolution enabled
- keep strict project-noise filtering enabled
- keep promoted/fresh packet packing enabled
- suppress stale packet items by default
- leave goals/patterns off by default unless no stronger bucket can explain current work
- winning config snapshot: `{"name": "cfg_balanced_roomy", "max_items_per_bucket": 8, "packet_chars": 420, "codec_globals": {"CODEC_PACKET_MAX_ITEMS_PER_BUCKET": 2, "CODEC_PACKET_INCLUDE_STALE": false, "CODEC_PACKET_USE_PROMOTION": true, "CODEC_PACKET_INCLUDE_GOALS": false, "CODEC_PACKET_INCLUDE_PATTERNS": false}}`

## 14. Exact validation run
- `pytest -q tests/test_cortex_codec.py tests/test_codec_policy.py tests/test_nexus_codec_integration.py tests/test_oracle_codec_integration.py` → `79 passed in 5.96s`
- `pytest -q tests/test_cortex_kernel_v2.py tests/test_nexus_codec_integration.py` → `30 passed in 2.20s`
- `pytest -q tests/test_cortex_codec.py tests/test_codec_policy.py tests/test_nexus_codec_integration.py tests/test_oracle_codec_integration.py tests/test_cortex_kernel_v2.py` → `88 passed in 5.73s`
- `pytest -q tests` → `457 passed in 64.09s`
