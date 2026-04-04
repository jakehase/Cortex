const MODULE = {
  "id": "benchmark-exchange",
  "ordinal": 146,
  "domain": "benchmark",
  "surfaceId": "exchange",
  "surfaceTitle": "Exchange",
  "routeSegment": "exchange",
  "title": "Benchmark Exchange",
  "focus": "Benchmark Exchange covers peer comparisons, maturity tracking, and reference baselines through handoff workflows and partner coordination.",
  "descriptor": "peer comparisons, maturity tracking, and reference baselines",
  "groupId": "revenue",
  "groupTitle": "Revenue, billing, and commerce operations",
  "groupDescription": "Revenue-centric operations that connect launches to billing posture, commerce readiness, and commercial recovery motions.",
  "metrics": [
    "gmv",
    "margin",
    "revenue",
    "recovery",
    "benchmark",
    "forecast"
  ],
  "lanes": [
    "baseline",
    "model",
    "reconcile",
    "approve",
    "share",
    "improve"
  ],
  "controls": [
    "finance-approval",
    "forecast-gap",
    "margin-guardrail",
    "merchant-review",
    "closeout-check",
    "variance-brief"
  ],
  "evidenceTypes": [
    "forecast-pack",
    "variance-deck",
    "billing-log",
    "merchant-summary",
    "revenue-snapshot",
    "close-report"
  ],
  "signals": [
    "gmv",
    "margin",
    "variance",
    "pacing",
    "refund",
    "collection"
  ],
  "persona": "revenue operations manager",
  "themes": [
    "benchmark",
    "exchange",
    "revenue",
    "mailchimp-clone-scale-wave-seven"
  ],
  "tags": [
    "benchmark",
    "exchange",
    "revenue",
    "benchmark-exchange-wave-seven"
  ]
};

export function createBenchmarkExchangePlaybooks() {
  return MODULE.lanes.map((lane, index) => ({
    id: MODULE.id + '-playbook-' + (index + 1),
    lane,
    title: MODULE.title + ' ' + lane + ' playbook',
    owner: MODULE.persona,
    steps: MODULE.controls.slice(0, 4).map((control, stepIndex) => ({
      id: MODULE.id + '-playbook-' + (index + 1) + '-step-' + (stepIndex + 1),
      control,
      instruction: 'Confirm ' + control + ' before advancing the ' + lane + ' motion.'
    }))
  }));
}

export function createBenchmarkExchangeDecisionDeck() {
  return MODULE.metrics.map((metric, index) => ({
    id: MODULE.id + '-decision-' + (index + 1),
    metric,
    question: 'Is ' + metric + ' strong enough to advance ' + MODULE.title + '?',
    owner: MODULE.persona,
    recommendation: index % 2 === 0 ? 'advance' : 'watch'
  }));
}

export function createBenchmarkExchangeEscalationMoments() {
  return MODULE.signals.map((signal, index) => ({
    id: MODULE.id + '-moment-' + (index + 1),
    signal,
    severity: index % 3 === 0 ? 'high' : 'medium',
    note: MODULE.surfaceTitle + ' surfaces ' + signal + ' during high-signal decision points.'
  }));
}

