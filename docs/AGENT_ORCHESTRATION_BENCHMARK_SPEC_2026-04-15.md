# Agent orchestration benchmark spec, 2026-04-15

## Reply anchor
Jake asked for a concrete benchmark spec with exact pass/fail thresholds, benchmark repo candidates, artifact schema, and a scoreboard, while keeping Mailchimp parity as the primary long-run proving ground.

## Decision
Mailchimp parity remains the primary long-run stress benchmark.
It is not being downgraded or removed.

The benchmark program should prove two things at once:
1. the system can sustain productive multi-agent execution for hours on a hard repo
2. the system is not merely overfit to the Mailchimp parity matrix

## Benchmark objective
Prove that the orchestration system can keep agents productively executing for long durations with truthful supervision, low no-op churn, real verifier-backed progress, and acceptable transfer to non-Mailchimp repos.

## Benchmark suite

### B1. Mailchimp parity, long-run stress benchmark
**Repo:** `/root/clawd/mailchimp-clone`

**Role:** primary stress benchmark

**Why this repo stays central:**
- large surface inventory
- enough remaining work to run for hours
- strong planner, handoff, verifier, and notifier pressure
- easy to detect fake progress, no-op loops, and truth drift
- contains both product-surface work and orchestration/honesty traps

**Primary questions answered:**
- can the system stay productive for hours
- can it route the next real surface after a blocker
- can it avoid repeated no-op loops
- can supervisor truth stay aligned with real artifacts

### B2. Brownfield product transfer benchmark
**Primary candidate:** `/root/clawd/pmhnpbilling-site`

**Fallback candidate:** `/root/clawd/pmhnp-denial-copilot`

**Role:** transfer benchmark for a non-Mailchimp product repo

**Selection criteria:**
- existing mixed frontend/backend surfaces
- enough real tests or inspectable product behavior to verify changes
- not organized like the Mailchimp parity matrix
- suitable for bugfix, feature, and refactor slices

**Primary questions answered:**
- does the planner adapt to a different repo topology
- does the system keep progress without Mailchimp-specific focus IDs
- does verifier-backed progress survive on a different product shape

### B3. Infra/control-plane transfer benchmark
**Primary candidate:** `/root/clawd/public/cortex_server`

**Fallback candidate:** `/root/clawd/large-project-capability-stack`

**Role:** transfer benchmark for architecture, contracts, routers, orchestration primitives, and reliability work

**Selection criteria:**
- non-product-surface-heavy work
- higher emphasis on contracts, routing, state, and verification truth
- good fit for refactors, audits, bug repair, and reliability patches

**Primary questions answered:**
- can the system handle control-plane and infra tasks, not just app UI flows
- can it preserve truth and handoff quality on architecture-heavy work
- can it operate without Mailchimp-style parity scaffolding

### B4. Incident benchmark
**Default source:** one failing benchmark or broken contract in either `public/cortex_server`, `plugins/`, or `large-project-capability-stack`

**Role:** diagnosis and repair benchmark

**Primary questions answered:**
- can the system move from failure signal to root cause to verified fix
- can it recover without drifting into blind patch spam
- can it contain scope under time pressure

## Benchmark ladder

### Tier 1, smoke
Use to prove basic orchestration integrity.

- agent count: 10
- run duration target: 30 to 60 minutes
- benchmark set: B1 + one of B2 or B3
- stop condition: `supervisor_green_or_blocker_report`

### Tier 2, endurance
Use to prove sustained productive flow.

- agent count: 25 to 40
- run duration target: 2 to 3 hours
- benchmark set: B1 + B2 + B3
- stop condition: `supervisor_green_or_blocker_report`

### Tier 3, scale
Use to prove long-duration scale, low dead time, and truthful supervision.

- agent count: 75 to 100
- run duration target: 4 to 6 hours minimum
- benchmark set: B1 primary, plus at least one transfer benchmark in the same evaluation window or the immediately adjacent evaluation window
- stop condition: `supervisor_green_or_blocker_report`

## Run contract required for every benchmark
Each benchmark run must declare:
- `benchmarkId`
- `benchmarkTier`
- `fidelity`
- `scope`
- `repoPath`
- `surfaceMatrixPath`
- `verifierSet`
- `requestedAgentCount`
- `executionBoundary`
- `stopCondition`
- `artifactRoot`
- `scoreboardPath`

### Allowed fidelity values
- `prototype`
- `production_slice`
- `parity_for_scope`
- `full_clone`

## Core metrics

### 1. Productive iteration rate
Definition:
`iterations_with_real_accepted_surface_diffs / total_iterations`

A productive iteration must include all of:
- real changed files on allowed product or architecture surfaces
- non-skipped relevant verifier evidence
- accepted or supervisor-credited progress

### 2. No-op rate
Definition:
`no_op_or_rejected_patch_attempts / total_patch_attempts`

Counts against the score:
- empty `modifiedFiles`
- rejected patches
- allowed-file mismatch rejections
- stale-focus reruns with no new admissible diff

### 3. Repeat-blocker rate
Definition:
`repeat_blocker_events_without_new_evidence / total_blocker_events`

A repeat blocker is the same blocker family recurring without:
- a new accepted diff
- a new verifier pass
- a changed focus target
- a changed root-cause classification

### 4. Time to next meaningful progress
Definition:
median minutes between accepted surface reductions

### 5. Verification integrity
Definition:
`accepted_progress_events_with_relevant_verifier_evidence / accepted_progress_events`

### 6. Handoff efficiency
Definition:
`work_units_that_move_cleanly_planner_to_worker_to_verifier_to_merge / total_started_work_units`

### 7. Autonomy window
Definition:
longest continuous period of productive execution without human intervention

### 8. Truth integrity
Definition:
number of supervisor/notifier claims contradicted by canonical artifacts

This must stay at zero for a passing run.

### 9. Transfer score
Definition:
`transfer_benchmark_score / mailchimp_benchmark_score`

This is a normalized ratio used only when at least one non-Mailchimp benchmark is present.

## Exact thresholds

### Tier 1 thresholds
A Tier 1 run passes only if all conditions hold:
- productive iteration rate: `>= 0.55`
- no-op rate: `<= 0.20`
- repeat-blocker rate: `<= 0.15`
- median time to next meaningful progress: `<= 12 minutes`
- verification integrity: `= 1.00`
- handoff efficiency: `>= 0.60`
- autonomy window: `>= 30 minutes`
- truth integrity contradictions: `0`
- fake-green incidents: `0`

### Tier 2 thresholds
A Tier 2 run passes only if all conditions hold:
- productive iteration rate: `>= 0.65`
- no-op rate: `<= 0.15`
- repeat-blocker rate: `<= 0.10`
- median time to next meaningful progress: `<= 15 minutes`
- verification integrity: `>= 0.95`
- handoff efficiency: `>= 0.70`
- autonomy window: `>= 2 hours`
- truth integrity contradictions: `0`
- fake-green incidents: `0`
- transfer score: `>= 0.70`

### Tier 3 thresholds
A Tier 3 run passes only if all conditions hold:
- productive iteration rate: `>= 0.70`
- no-op rate: `<= 0.10`
- repeat-blocker rate: `<= 0.08`
- median time to next meaningful progress: `<= 20 minutes`
- verification integrity: `>= 0.95`
- handoff efficiency: `>= 0.75`
- autonomy window: `>= 4 hours`
- truth integrity contradictions: `0`
- fake-green incidents: `0`
- transfer score: `>= 0.75`

## Hard fail conditions
Any benchmark run fails immediately if any of these occur:
- supervisor claims green while canonical artifact root is red or blocked
- notifier delivers completion for the wrong run id or stale artifact root
- execution runs on the control plane when the benchmark requires remote heavy execution
- more than 3 consecutive no-progress iterations on the same blocker family without a new root-cause classification
- docs/tests-only diff is counted as feature completion
- allowed-file contract is violated and still credited
- completion claim is emitted without relevant verifier evidence

## Anti-gaming rules
- Mailchimp cannot be the only benchmark used to declare the system proven
- at least one transfer benchmark must pass before claiming orchestration maturity
- docs/tests/scripts-only changes can count as scaffolding, not feature progress
- repeated focus reruns without new admissible diffs count as failure pressure, not perseverance
- hidden human steering between iterations must be logged as intervention and subtract from autonomy scoring
- benchmark success must be judged from canonical artifact roots, not chat summaries

## Artifact contract
Each run must write a benchmark artifact root:

`artifacts/benchmarks/<benchmarkId>/<runId>/`

### Required files
- `run_contract.json`
- `surface_matrix.json`
- `program_state.json`
- `supervisor_status.json`
- `completion_summary.json`
- `blocker_report.json` when blocked
- `scoreboard_row.json`
- `iteration_ledger.json`
- `verifier_evidence.json`
- `intervention_log.json`
- `remote_execution_status.json` when remote execution is used
- `notifier_eligibility.json`
- `truth_conflicts.json`

### Artifact schema, canonical summary
```json
{
  "benchmarkId": "mailchimp_long_run",
  "benchmarkTier": "tier3_scale",
  "runId": "benchmark-20260415-001",
  "fidelity": "parity_for_scope",
  "scope": {
    "surfaces": ["focus.reporting_analytics_parity", "focus.ai_predictive_parity"],
    "requestedAgentCount": 100,
    "durationTargetMinutes": 360
  },
  "repo": {
    "path": "/root/clawd/mailchimp-clone",
    "commit": "<git-sha-or-null>",
    "executionBoundary": "remote_execution_required"
  },
  "status": {
    "supervisorStatus": "red",
    "matrixStatus": "partial",
    "parityStatus": "partial",
    "stopReason": "supervisor_red_with_blocker"
  },
  "metrics": {
    "productiveIterationRate": 0.68,
    "noOpRate": 0.09,
    "repeatBlockerRate": 0.05,
    "medianMinutesToMeaningfulProgress": 14,
    "verificationIntegrity": 1.0,
    "handoffEfficiency": 0.76,
    "autonomyWindowMinutes": 257,
    "truthIntegrityContradictions": 0,
    "fakeGreenIncidents": 0,
    "transferScore": null
  },
  "outcome": {
    "pass": false,
    "failedThresholds": ["productiveIterationRate"],
    "blocker": {
      "family": "planner_grounding",
      "message": "Planner emitted 2 no-op patch candidate(s)."
    }
  },
  "artifacts": {
    "surfaceMatrixPath": "artifacts/benchmarks/mailchimp_long_run/benchmark-20260415-001/surface_matrix.json",
    "scoreboardRowPath": "artifacts/benchmarks/mailchimp_long_run/benchmark-20260415-001/scoreboard_row.json"
  }
}
```

## Scoreboard
The scoreboard is the compact cross-run truth table.

### Canonical path
`artifacts/benchmarks/scoreboard.json`

### One row per run
```json
{
  "generatedAt": "2026-04-15T23:40:00Z",
  "rows": [
    {
      "runId": "benchmark-20260415-001",
      "benchmarkId": "mailchimp_long_run",
      "tier": "tier3_scale",
      "repoPath": "/root/clawd/mailchimp-clone",
      "requestedAgentCount": 100,
      "durationMinutes": 312,
      "productiveIterationRate": 0.68,
      "noOpRate": 0.09,
      "repeatBlockerRate": 0.05,
      "medianMinutesToMeaningfulProgress": 14,
      "verificationIntegrity": 1.0,
      "handoffEfficiency": 0.76,
      "autonomyWindowMinutes": 257,
      "truthIntegrityContradictions": 0,
      "fakeGreenIncidents": 0,
      "transferScore": null,
      "pass": false,
      "blockerFamily": "planner_grounding",
      "blockerSemantics": "retryable",
      "notes": "Strong run, but below Tier 3 productive-iteration threshold."
    }
  ]
}
```

### Required scoreboard columns
- `runId`
- `benchmarkId`
- `tier`
- `repoPath`
- `requestedAgentCount`
- `durationMinutes`
- `productiveIterationRate`
- `noOpRate`
- `repeatBlockerRate`
- `medianMinutesToMeaningfulProgress`
- `verificationIntegrity`
- `handoffEfficiency`
- `autonomyWindowMinutes`
- `truthIntegrityContradictions`
- `fakeGreenIncidents`
- `transferScore`
- `pass`
- `blockerFamily`
- `blockerSemantics`
- `notes`

## Evaluation policy

### When the orchestration system may be called proven
Only if all of the following are true:
- B1 Mailchimp passes Tier 2 at least once and Tier 3 at least once
- at least one of B2 or B3 passes at Tier 2 or higher
- truth integrity contradictions remain zero across the proving window
- fake-green incidents remain zero across the proving window
- transfer score remains at or above threshold for the relevant tier

### When the orchestration system is not yet proven
Any of the following is enough to keep the claim red:
- Mailchimp is the only passing benchmark
- transfer benchmark performance collapses relative to Mailchimp
- repeated no-progress loops remain common
- the system needs frequent human nudges to escape blocker families
- notifier/supervisor truth disagrees with canonical artifacts

## Immediate benchmark program to run

### Phase 1
- keep Mailchimp as the primary long-run benchmark
- add one brownfield product transfer run on `pmhnpbilling-site`
- add one infra/control-plane transfer run on `public/cortex_server`

### Phase 2
- produce `scoreboard.json` rows for all three
- compare transfer score against Mailchimp
- identify which failures are orchestration-general versus Mailchimp-specific

### Phase 3
- only after the above, decide whether the system is underpowered, overfit, or genuinely maturing

## Recommendation
Continue using Mailchimp parity.
Do not let it remain the only benchmark.

The right question is not whether Mailchimp is too hard.
The right question is whether the system can perform on Mailchimp **and** transfer beyond it without losing truth, throughput, or autonomy.
