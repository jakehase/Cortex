# Mailchimp Full Clone Credibility Path Report — 2026-04-02

Qualification target: /root/clawd/mailchimp-clone
Current certified claim: scoped_parity
Target claim: large_product_replica

## Current truth gate state
- Requested claim allowed: false
- Highest allowed claim: scoped_parity
- Truth qualification matrix status: all_complete
- Truth completion summary supervisor confirmed: true
- Browser evidence driver: http-bridge-simulated-browser
- Real browser proven: false

## Why the stronger claim is still denied
- productFiles_below_minimum
- productLines_below_minimum
- testFiles_below_minimum
- testLines_below_minimum
- packageCount_below_minimum
- appCount_below_minimum
- moduleRoots_below_minimum
- routeFiles_below_minimum
- domainFiles_below_minimum
- surfaceFamiliesComplete_below_minimum
- parityChecks_below_minimum
- liveHttpChecks_below_minimum
- browserChecks_below_minimum
- evidenceArtifacts_below_minimum
- repoShape_below_score_target
- codeVolume_below_score_target
- testBreadth_below_score_target
- browserGrade_below_score_target
- realBrowser_not_met
- missing_surface_family:content_asset_templates
- missing_surface_family:integrations_marketplace
- missing_surface_family:commerce_revenue
- missing_surface_family:collaboration_approval
- missing_surface_family:deliverability_compliance

## Quantified shortfalls to the large_product_replica minimum
- Product files: 20 / 250
- Product lines: 1701 / 750000
- Test files: 8 / 80
- Test lines: 933 / 120000
- Package count: 2 / 20
- Module roots: 2 / 20
- Route files: 8 / 60
- Domain files: 4 / 40
- Complete surface families: 7 / 12
- Browser checks: 2 / 20

## Missing required surface families
- content_asset_templates
- integrations_marketplace
- commerce_revenue
- collaboration_approval
- deliverability_compliance

## Recommended roadmap lanes
- M1.browser-proof-foundation [browser_realism] -> Install real browser qualification and replace simulated adapter evidence for large product replica
- M2.architecture-breadth-expansion [architecture_scale] -> Expand repo/module/package breadth past the large product replica minimums
- M3.surface-family-expansion [product_surface] -> Add the missing product surface families that large product replica expects
- M4.test-and-parity-depth [evidence_depth] -> Raise test breadth, parity depth, and executable evidence density
- M5.requalify-full-clone-claim [qualification] -> Re-run truth qualification and require large product replica to pass mechanically

## Trajectory reading
- Estimated product lines still needed to clear the minimum: 748299
- Estimated test lines still needed to clear the minimum: 119067
- Estimated new packages: 18
- Estimated new module roots: 18
- Estimated family expansions: 6

## Bottom line
The current repo is still materially short of large_product_replica. It is honestly classifiable as scoped_parity under the refreshed truth gate, but it still needs real browser proof plus massive architecture, code-volume, and surface-family expansion before the stronger claim is mechanically believable.
