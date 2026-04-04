const MODULE = {
  "id": "attribution-scorecard",
  "ordinal": 95,
  "domain": "attribution",
  "surfaceId": "scorecard",
  "surfaceTitle": "Scorecard",
  "routeSegment": "scorecard",
  "title": "Attribution Scorecard",
  "focus": "Attribution Scorecard covers touchpoint weighting, influence mapping, and outcome reconciliation through metric tracking and readiness scoring.",
  "descriptor": "touchpoint weighting, influence mapping, and outcome reconciliation",
  "groupId": "intelligence",
  "groupTitle": "Data, experimentation, and segmentation intelligence",
  "groupDescription": "Analytical workspaces that connect data readiness, experimentation posture, segmentation depth, and attribution signals.",
  "metrics": [
    "freshness",
    "coverage",
    "confidence",
    "throughput",
    "lineage",
    "lift"
  ],
  "lanes": [
    "collect",
    "score",
    "verify",
    "activate",
    "compare",
    "publish"
  ],
  "controls": [
    "lineage-proof",
    "quality-threshold",
    "segment-review",
    "integration-watch",
    "publish-approval",
    "lift-audit"
  ],
  "evidenceTypes": [
    "data-contract",
    "segment-card",
    "experiment-summary",
    "lineage-map",
    "publication-brief",
    "insight-review"
  ],
  "signals": [
    "freshness",
    "lift",
    "match-rate",
    "coverage",
    "confidence",
    "latency"
  ],
  "persona": "analytics program lead",
  "themes": [
    "attribution",
    "scorecard",
    "intelligence",
    "mailchimp-clone-scale-wave-seven"
  ],
  "tags": [
    "attribution",
    "scorecard",
    "intelligence",
    "attribution-scorecard-wave-seven"
  ]
};

export function createAttributionScorecardPlaybooks() {
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

export function createAttributionScorecardDecisionDeck() {
  return MODULE.metrics.map((metric, index) => ({
    id: MODULE.id + '-decision-' + (index + 1),
    metric,
    question: 'Is ' + metric + ' strong enough to advance ' + MODULE.title + '?',
    owner: MODULE.persona,
    recommendation: index % 2 === 0 ? 'advance' : 'watch'
  }));
}

export function createAttributionScorecardEscalationMoments() {
  return MODULE.signals.map((signal, index) => ({
    id: MODULE.id + '-moment-' + (index + 1),
    signal,
    severity: index % 3 === 0 ? 'high' : 'medium',
    note: MODULE.surfaceTitle + ' surfaces ' + signal + ' during high-signal decision points.'
  }));
}

