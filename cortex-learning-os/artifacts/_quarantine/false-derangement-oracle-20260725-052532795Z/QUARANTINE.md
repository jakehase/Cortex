# Quarantined false-negative learning run

- Original run: `math-foundations-smoke-20260725-052532795Z`
- Quarantined: 2026-07-25 CDT
- Reason: the challenge generator incorrectly encoded derangement counts as `0`. Cortex answered `D_10 = 1334961` and `D_6 = 265`, both correctly, but the bad deterministic oracle labeled them failures.
- Trust effect: no candidate or trusted lesson was produced; `defaultPromoted=false`.
- Recovery: retain this root as verifier-regression evidence only. Never use it as learning or capability evidence.
