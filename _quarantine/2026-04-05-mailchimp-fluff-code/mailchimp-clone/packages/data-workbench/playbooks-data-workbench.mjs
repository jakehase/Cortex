const MODULE = {
  "id": "data-workbench",
  "ordinal": 378,
  "domain": "data",
  "surfaceId": "workbench",
  "surfaceTitle": "Workbench",
  "routeSegment": "workbench",
  "title": "Data Workbench",
  "focus": "Data Workbench covers pipeline health, lineage, freshness, and operator trust in data assets through hands-on workflows and analyst tooling.",
  "descriptor": "pipeline health, lineage, freshness, and operator trust in data assets",
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
    "data",
    "workbench",
    "intelligence",
    "mailchimp-clone-scale-wave-seven"
  ],
  "tags": [
    "data",
    "workbench",
    "intelligence",
    "data-workbench-wave-seven"
  ]
};

export function createDataWorkbenchPlaybooks() {
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

export function createDataWorkbenchDecisionDeck() {
  return MODULE.metrics.map((metric, index) => ({
    id: MODULE.id + '-decision-' + (index + 1),
    metric,
    question: 'Is ' + metric + ' strong enough to advance ' + MODULE.title + '?',
    owner: MODULE.persona,
    recommendation: index % 2 === 0 ? 'advance' : 'watch'
  }));
}

export function createDataWorkbenchEscalationMoments() {
  return MODULE.signals.map((signal, index) => ({
    id: MODULE.id + '-moment-' + (index + 1),
    signal,
    severity: index % 3 === 0 ? 'high' : 'medium',
    note: MODULE.surfaceTitle + ' surfaces ' + signal + ' during high-signal decision points.'
  }));
}

