# Mailchimp true 1:1 execution brief — 2026-04-04

## Grounding
- Reply anchor: user explicitly requested one **full**, **extremely in-depth** pass to finish the Mailchimp **1:1 clone entirely**, with no time pressure.
- Anchor set:
  - `docs/MAILCHIMP_1TO1_AUDIT_2026-04-04.md`
  - `docs/MAILCHIMP_TRUE_1TO1_GAP_CLOSURE_PLAN_2026-04-04.md`
  - `docs/MAILCHIMP_CURRENT_PRODUCT_PARITY_GAP_ROADMAP_2026-04-03.md`
- Target path: `/root/clawd/mailchimp-clone`

## Contract
- Fidelity: `full_clone`
- Scope: all remaining gaps required to truthfully certify Mailchimp 1:1 parity across frontend, backend, workflows, data model, integrations/provider realism, and operations.
- Campaign mode: `persistent`
- Stop condition: `supervisor_green_or_blocker_report`

## Non-negotiables
- Do not relabel partial work as 1:1 completion.
- Do not stop after a single pass if the supervisor is still red and there is no blocker report.
- Completion requires concrete parity evidence, not just repo-local green tests.

## Required artifacts
- strict surface matrix with status per parity lane
- supervisor state artifact
- blocker report if parity cannot be fully achieved in this campaign
- final report only if supervisor green or blocker is explicit
