# Mailchimp full-clone replan — cleaned baseline — 2026-04-04

## Grounding
- **Anchor:** `docs/MAILCHIMP_FULL_AUDIT_2026-04-04.md`
- **Checklist anchor:** `docs/MAILCHIMP_FULL_AUDIT_GAP_CLOSURE_CHECKLIST_2026-04-04.md`
- **Cleanup trigger:** removal/quarantine of LOC-inflation surfaces that were not truthful active Mailchimp product code
- **Target path:** `/root/clawd/mailchimp-clone`
- **Requested fidelity:** `full_clone`
- **Current truthful fidelity:** `prototype` moving toward `production_slice` and eventually `parity_for_scope`

## Why this replan exists
The prior wave6 / LOC-inflation path made the repo look much larger than it really was. That distorted:
- line-count expectations
- worker planning
- campaign validation assumptions
- what the 100-agent orchestrator was actually spending time on

That path has now been intentionally stopped and quarantined.

## Clean baseline after truthful cleanup
Observed on the cleaned repo:
- **product LOC:** `16,949`
- **test LOC:** `3,848`
- **total relevant LOC:** `20,797`
- **packages:** `88`
- **apps:** `8`
- **tests:** `138 / 138` passing

## What changed
Quarantined out of the active tree:
- generated package/app/test/script/artifact mass used mainly for volume inflation
- wave6 and expansion-showcase surfaces
- old wave6-based 100-agent delegate surfaces

Active app hooks removed:
- `/expansion-showcase`
- `/scale-wave-six`
- `/scale-wave-seven`

## Honest status after cleanup
The repo is now much more truthful, but it is also much smaller than the previous inflated presentation suggested.

So the correct next move is **not** to resume the old 100-agent wave6 delegate.

The correct next move is to plan the next implementation campaign against the cleaned baseline.

## New campaign intent
### Fidelity target
- long-term target: `full_clone`
- immediate truthful execution target: `production_slice`

### Immediate implementation objective
Build upward from the cleaned, real Mailchimp-like surfaces instead of regenerating synthetic breadth.

### Active product families to deepen first
1. **Public marketing / brand parity**
2. **Frontend interaction depth for core builders/editors**
3. **Campaign creation/editor/send/reporting realism**
4. **Audience/segmentation/CRM depth**
5. **Forms / landing pages / websites**
6. **Integrations / API / webhooks**
7. **Persistence and jobs architecture realism**

## Recommended next 100-agent topology
Do not use the old wave6 generator campaign.

Instead, use a cleaned-repo campaign with lanes roughly split into:
- **Lane A:** public-facing marketing parity
- **Lane B:** app-shell/editor UX depth
- **Lane C:** data model + persistence migration
- **Lane D:** campaign pipeline realism
- **Lane E:** audience/segmentation/CRM
- **Lane F:** forms/landing pages/websites
- **Lane G:** integrations/API/webhooks
- **Lane H:** reports/analytics/event realism
- **Lane I:** supervisor/evidence/browser validation

## Stop-condition truth
Do not claim `full_clone` from this cleaned baseline until:
- frontend/editor parity is materially deeper
- persistence/jobs are more realistic
- analytics/integrations are more realistic
- public site parity is materially stronger
- the supervisor matrix is rebuilt around the cleaned repo and then actually turns green

## Immediate next action
Create a **new cleaned-baseline 100-agent plan** that targets real parity gaps instead of code-volume thresholds.
