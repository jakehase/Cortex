# Truth Gating, Claim Ladder, and Browser Evidence Model

## Claim ladder

Public claims are constrained by an evidence-weighted ladder:
- `prototype`
- `production_slice`
- `scoped_parity`
- `full_clone_credible`
- `large_product_replica`
- `real_world_indistinguishable`

The qualification artifacts also expose machine-readable truth flags:
- `scoped_completion_green`
- `parity_for_scope_plausible`
- `full_clone_credible`
- `large_product_replica`
- `real_world_indistinguishable_not_proven`

This lets the system say:
- yes, the requested scoped work is green
- yes, parity for that scoped surface is plausible
- no, that still does not make the repo a Mailchimp-scale large-product replica

Interpretation of the upper ladder:
- `full_clone_credible` is now a **mid-tier** claim: stronger than scoped parity, but still far below a true Mailchimp-scale replica.
- `large_product_replica` is the first claim intended to represent a genuinely large, complex product replica.
- The current threshold model treats `large_product_replica` as requiring a floor in the **750k+ product-line** class, plus much broader architecture, tests, browser proof, and surface-family coverage.
- `real_world_indistinguishable` is materially above that: it expects multi-app/package breadth, high-volume real-browser proof across journey families, full enterprise/admin/compliance and ecosystem coverage, and artifact realism deep enough that the repo would look operationally hard to distinguish from a mature real-world product.

## Evidence shape

Certification uses multiple dimensions instead of a single LOC threshold:
- repo shape
- code volume
- test breadth
- architecture split
- evidence depth
- browser grade

Architecture budgets add executable realism checks such as:
- anti single-file collapse
- minimum package/module counts for stronger claims
- app/package/test/docs/artifacts separation
- route/domain split expectations

## Browser evidence model

Parity evidence is classified mechanically:
- `fixture` — synthetic only
- `http` — live runtime checks, but no browser proof
- `browser_adapter` with `browser.real=false` — structured browser-like driver, still not real browser proof
- future real browser runs should report `browser.real=true`

If real browser proof is absent, the parity artifact records downgrade signals like:
- `http_only_evidence`
- `simulated_browser_adapter`
- `no_real_browser_proof`

That downgrade signal is consumed by certification so a repo cannot be certified as `large_product_replica` on HTTP-only or simulated-browser evidence alone.

## Qualification behavior

The phase-2 qualification against `/root/clawd/mailchimp-clone` is intentionally stricter:
- it can confirm `scoped_completion_green`
- it can allow `scoped_parity`
- it can still deny `full_clone_credible`
- it should deny `large_product_replica` unless the repo has very large architecture/code/test/browser evidence
- it should usually deny `real_world_indistinguishable` unless extraordinary proof exists

Current artifact roots:
- truth qualification: `artifacts/qualification/mailchimp_full_clone_truth/`
- real-world-indistinguishability path: `artifacts/qualification/mailchimp_real_world_indistinguishable_path/`
