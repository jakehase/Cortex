# Catalyst Radar

Non-trading pilot for “boring public-source arbitrage for prediction markets.”

## Goal

Find prediction markets whose resolution depends on fragmented but authoritative public sources, then produce an evidence plan and candidate ranking.

This pilot does **not** place trades, recommend financial action, or use authenticated exchange endpoints. It only reads public market data and maps markets to public-source monitoring plans.

## Starting niche

Regulatory + legal outcome markets:

- agency approvals, bans, fines, enforcement actions
- court decisions, injunctions, lawsuit settlement/resolution
- SEC/FDA/FTC/DOJ/CFTC/FCC/EPA actions
- bills, committees, rulemaking, Federal Register notices

## Current pipeline

```bash
node scripts/pilot-scan.mjs
```

Outputs:

- `data/latest-candidates.json` — machine-readable candidate list
- `data/latest-candidates.md` — compact human review sheet

## Candidate score meaning

The score is a sourceability heuristic, not an edge/probability model:

- market has legal/regulatory keywords
- has enough liquidity/volume to care about
- has resolution text/source details
- can be mapped to authoritative public sources
- has enough time left to monitor

## Next build steps

1. Add per-candidate source agents that fetch the actual authority pages.
2. Extract dated evidence facts into `evidence[]`.
3. Add red-team checks for counterevidence and ambiguous resolution rules.
4. Only after stable evidence quality: compare inferred probability to market odds.
5. Keep trading/manual execution outside the system unless explicitly approved.
