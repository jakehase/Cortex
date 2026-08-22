# Mailchimp Full Clone Truth Qualification Report — 2026-04-02

Qualification target: /root/clawd/mailchimp-clone
Requested public claim: large_product_replica
Highest allowed claim: scoped_parity

Observed evidence:
- Target self-supervisor currently reports green/all_complete for its own internal surface matrix.
- Stack truth gate re-ran tests, architecture checks, live HTTP parity checks, and browser-adapter evidence.
- Browser-grade proof is still simulated adapter evidence, not a real browser automation run.

Truth gate result:
- scoped_completion_green: true
- parity_for_scope_plausible: true
- full_clone_credible: false
- large_product_replica: false
- real_world_indistinguishable_not_proven: true

Why the stronger claim is denied:
- full_clone_credible_not_established
- insufficient_parity_depth_for_large_product_replica
- repo_shape_too_small_for_large_product_replica
- code_volume_too_small_for_large_product_replica
- test_breadth_too_small_for_large_product_replica
- insufficient_real_browser_proof_for_large_product_replica
- product_files_below_250
- product_source_lines_below_750000
- test_files_below_80
- package_count_below_20

Interpretation:
- The current Mailchimp clone can be green for scoped completion and scoped parity evidence.
- It is not yet credible as a Mailchimp-scale large-product replica or a real-world indistinguishable product.
- This is the intended stricter behavior: honest downgrade instead of overclaiming.
