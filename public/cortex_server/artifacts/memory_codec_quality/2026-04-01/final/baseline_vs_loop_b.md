# Baseline vs Loop B Comparison

- baseline_pass_rate: 0.341
- loop_b_pass_rate: 0.886
- pass_rate_gain: 0.545
- false_memory_reduction: 0.545
- stale_memory_reduction: 0.114
- winner_config: cfg_balanced_roomy

## Remaining weakness
- Single-item preference packets still fail the corpus compression-ratio gate because the rubric requires ratio >= 1.0 even when label overhead dominates tiny packets.