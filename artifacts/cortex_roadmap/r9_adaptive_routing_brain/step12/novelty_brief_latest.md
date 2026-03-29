# R9 Adaptive Routing Brain — Novelty Brief

## Framing
This package argues for a practical novelty slice: dynamic multi-objective routing under explicit risk constraints with rollback and operator observability.

## Strongest supported claims
- **Dynamic multi-objective route scoring is explicit and inspectable** — Weights, objectives, utility formula, and per-candidate utility terms are exposed directly.
- **Candidate generation enforces risk- and taxonomy-aware hard constraints** — Allowed chains and required core levels are validated per case.
- **Bootstrap routing policy shows positive replay lift on reproducible fixture data** — Primary replay score is bootstrap-scored; native bandit replay is supplemental only.
- **Rollback envelope triggers correctly under synthetic failure drills** — Quality regression, latency spike, and risk violation all trigger rollback under SLA in the drill suite.
- **Operator-facing control plane exists for local observability and runbook drills** — Controls are local stubs, so this supports observability/runbook claims rather than production control claims.

## Claim discipline
- Supported claims: 5
- Partial claims: 0
- Not-supported claims: 1
- Do not overclaim live production maturity beyond the committed artifacts.

## Reproducibility
- The routing package includes executable scripts for baseline telemetry, taxonomy, feature extraction, scoring, candidate generation, replay, rollback drills, shadow, canary, rollout probe, and dashboard generation.
- Artifact count in pack: 20

## Suggested claim language
- Safe: 'We implemented a local adaptive routing stack that combines explicit multi-objective scoring, risk-aware chain filtering, replay evaluation, rollback drills, and operator-facing observability.'
- Safe: 'The repo demonstrates a reproducible bootstrap routing system rather than a fully proven live-production optimizer.'
- Avoid: 'This is already proven at scale on live production traffic.'
