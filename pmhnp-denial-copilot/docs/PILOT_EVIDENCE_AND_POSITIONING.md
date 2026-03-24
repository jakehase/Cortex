# PMHNP Claim Guard Pilot — Evidence + Positioning

## Product wedge

This product is now framed around a single wedge:

**Take Tebra exports from a PMHNP practice, flag likely denials before submit, organize denied claims after they land, route the next action, and prove ROI during the pilot.**

## Why this wedge is more credible

- It is narrow enough to sell and test
- It uses data PMHNP practices already have in Tebra
- It maps directly to recoverable revenue and staff time
- It avoids pretending full autonomous billing is already solved

## In-repo evidence scaffolding

### Denial intelligence

Implemented in `src/domain/denialWorkbench.mjs`:

- PMHNP denial taxonomy
- specialty ruleset for denial scoring
- feedback capture for reviewer-confirmed labels

Routes:

- `GET /v1/denials/taxonomy`
- `POST /v1/denials/score`
- `GET /v1/denials/feedback`
- `POST /v1/denials/feedback`

### Pilot ROI instrumentation

Implemented in `src/domain/pilotMetrics.mjs`.

Routes:

- `GET /v1/pilot/baseline`
- `POST /v1/pilot/baseline`
- `POST /v1/pilot/event`
- `POST /v1/pilot/report`

Tracked metrics:

- denials reviewed
- denials overturned
- prevented denials
- dollars recovered
- dollars protected
- staff minutes saved
- appeal turnaround days improved
- estimated ROI %

## Limits

This repo now has the instrumentation and reporting structure needed for a fundable pilot story.

What it does **not** do yet by itself:

- ingest real payer remits automatically
- prove real ROI without pilot event entry
- replace billing staff judgment
- support self-serve Tebra OAuth
- perform live claim submission/writeback

That limit should be stated plainly in demos and investor conversations.
