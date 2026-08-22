# Agent Work v1.1.0 Release Notes

Release tag: `agent-work-v1.1.0`
Fidelity: `production_slice`
Audience: private/internal

## Changed

- Agent count is optional. When omitted, Agent Work uses the canonical `semantic_auto` workforce policy instead of silently defaulting to one worker.
- Explicit operator counts remain supported as upper bounds; they cannot fabricate parallelism beyond independent dependency-ready work.
- Phase 4 now separates admitted executable workforce sizing from broader decomposition/negative-space capacity.
- The objective controller consumes the semantic target for every wave and can adapt downward under provider failures, verifier or merge backlog, low productive-merge rate, and execution-plane pressure.
- Workforce decisions include stable digests and history while preserving separate truth for planned, spawned, started, completed, productive, merged, and provider-observed workers.
- Unknown file ownership is treated conservatively as overlap; low-complexity prototype work may be consolidated rather than over-sharded.

## Compatibility

Existing objectives with an explicit agent count continue to work. The explicit value is interpreted as a safe maximum. Objectives without a count now receive bounded automatic sizing with a default maximum of 12, subject to ready-work independence and all harder resource and budget caps.

## Exact boundary

This minor release carries forward the v1.0.0 private/internal `production_slice` qualification and makes semantic workforce sizing the canonical default. It does not prove new physical concurrency, public deployment, universal parity, or full-clone completion. Heavy execution remains execution-plane-only and external actions remain denied by default.

See `SEMANTIC_WORKFORCE.md` for the scheduling contract and truth boundary.
