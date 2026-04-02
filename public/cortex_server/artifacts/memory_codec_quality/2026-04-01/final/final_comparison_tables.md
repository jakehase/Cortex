# Final comparison tables

## Aggregate metrics

### baseline
- overall_pass_rate: 0.341
- false_memory_rate: 0.659
- stale_memory_failure_rate: 0.114
- omission_rate: 0.045
- preference_recall_accuracy: 0.0
- open_loop_continuity_accuracy: 0.538
- codec_overuse_rate: 0.0
- codec_underuse_rate: 0.045
- avg_packet_chars: 98.114
- avg_latency_ms: 0.573

### loop_a
- overall_pass_rate: 0.773
- false_memory_rate: 0.227
- stale_memory_failure_rate: 0.114
- omission_rate: 0.0
- preference_recall_accuracy: 0.5
- open_loop_continuity_accuracy: 0.923
- codec_overuse_rate: 0.0
- codec_underuse_rate: 0.045
- avg_packet_chars: 67.182
- avg_latency_ms: 0.637

### loop_b
- overall_pass_rate: 0.886
- false_memory_rate: 0.114
- stale_memory_failure_rate: 0.0
- omission_rate: 0.0
- preference_recall_accuracy: 0.5
- open_loop_continuity_accuracy: 1.0
- codec_overuse_rate: 0.0
- codec_underuse_rate: 0.045
- avg_packet_chars: 53.068
- avg_latency_ms: 0.575

### winner
- overall_pass_rate: 0.886
- false_memory_rate: 0.114
- stale_memory_failure_rate: 0.0
- omission_rate: 0.0
- preference_recall_accuracy: 0.5
- open_loop_continuity_accuracy: 1.0
- codec_overuse_rate: 0.0
- codec_underuse_rate: 0.045
- avg_packet_chars: 53.068
- avg_latency_ms: 0.605

## Winner matrix context
- cfg_balanced_roomy: score=0.584 pass=0.886 false=0.114 stale=0.0 packet=53.068
- cfg_balanced_320: score=0.584 pass=0.886 false=0.114 stale=0.0 packet=53.068
- cfg_balanced_280: score=0.584 pass=0.886 false=0.114 stale=0.0 packet=53.068
- cfg_no_promotion: score=0.584 pass=0.886 false=0.114 stale=0.0 packet=53.068
- cfg_goals_patterns_on: score=0.557 pass=0.841 false=0.159 stale=0.045 packet=62.773
- cfg_compact_220: score=0.539 pass=0.841 false=0.159 stale=0.0 packet=52.227
- cfg_stale_allowed: score=0.509 pass=0.773 false=0.227 stale=0.114 packet=56.523
- cfg_legacy_roomy: score=0.508 pass=0.773 false=0.227 stale=0.114 packet=67.182
