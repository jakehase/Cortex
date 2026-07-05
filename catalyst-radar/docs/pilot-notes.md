# Catalyst Radar pilot notes

Generated from the first live non-trading scan.

## Anchor

Reply-thread idea: “Boring public-source arbitrage for prediction markets” / Catalyst Radar.

## What was built

- `scripts/pilot-scan.mjs`
  - Reads public unauthenticated market data.
  - Polymarket: Gamma API `https://gamma-api.polymarket.com/markets` with a normal user-agent.
  - Kalshi: public Trade API `https://external-api.kalshi.com/trade-api/v2/markets`.
  - Filters for legal/regulatory/company-filing sourceability.
  - Writes JSON + markdown candidate reports.
- `data/latest-candidates.json`
- `data/latest-candidates.md`

## Latest scan

- Input: 1000 Polymarket markets + 600 Kalshi open markets.
- Fetch errors: none.
- Candidates retained: 94.
- Trading action: none.

## Best clean niche candidate found

`SCOTUS accepts sports event contract case by July 31, 2026?`

Why it is a good pilot candidate:

- concrete public source path: Supreme Court docket / orders lists / petition status
- binary resolution is likely tied to a dated court action
- enough liquidity/volume to be worth monitoring
- good fit for red-team counterevidence: no cert grant, relist/deny/order ambiguity, alternate related case confusion

First source-agent plan:

1. Parse market text and identify the case/petition names.
2. Search SCOTUS docket and orders lists.
3. Search CourtListener/RECAP for related lower-court dockets.
4. Extract events: petition filed, response requested, distributed for conference, relisted, granted/denied.
5. Red-team: verify the market’s “sports event contract case” phrase maps to the exact petition(s), not a broader legal issue.

## What the first scan taught us

- Polymarket Gamma and Kalshi public market APIs are usable without auth for discovery.
- Polymarket needed a normal user-agent; bare Python initially got 403.
- Naive keyword matching is noisy:
  - `sec` matched words like “second/specifically” until boundary matching was added.
  - election markets mention electoral courts but are not our starting niche.
  - approval-rating markets look like “approval” until health/regulatory context is required.
- The product moat is not the market fetch; it is source mapping + evidence quality + red-team filtering.

## Current limitations

- Candidate score is sourceability only, not probability or EV.
- No real source agents yet; source plans are heuristic strings.
- No deduplication across linked markets beyond ticker/id.
- No clustering of mutually exclusive market families yet.
- No confidence model and no odds comparison beyond recording a displayed yes price.

## Recommended next build

Build the first source agent for the SCOTUS sports-event-contract market:

- input: candidate object from `latest-candidates.json`
- output: `evidence-pack.json`
- fields:
  - `marketId`
  - `resolutionQuestion`
  - `sourceQueries[]`
  - `observedFacts[]`
  - `counterEvidence[]`
  - `ambiguities[]`
  - `sourceConfidence`
  - `probabilityDeltaReady: false|true`

Keep it read-only and no-trading until evidence extraction is consistently trustworthy.
