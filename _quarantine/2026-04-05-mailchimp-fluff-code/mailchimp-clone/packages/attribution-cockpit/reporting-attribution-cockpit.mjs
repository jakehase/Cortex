const MODULE = {
  "id": "attribution-cockpit",
  "ordinal": 83,
  "domain": "attribution",
  "surfaceId": "cockpit",
  "surfaceTitle": "Cockpit",
  "routeSegment": "cockpit",
  "title": "Attribution Cockpit",
  "focus": "Attribution Cockpit covers touchpoint weighting, influence mapping, and outcome reconciliation through operator controls and active monitoring.",
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
    "cockpit",
    "intelligence",
    "mailchimp-clone-scale-wave-seven"
  ],
  "tags": [
    "attribution",
    "cockpit",
    "intelligence",
    "attribution-cockpit-wave-seven"
  ]
};

export function createAttributionCockpitReportCards() {
  return MODULE.metrics.map((metric, index) => ({
    id: MODULE.id + '-report-' + (index + 1),
    title: MODULE.title + ' ' + metric + ' review',
    audience: index % 2 === 0 ? 'executive' : 'operator',
    summary: MODULE.title + ' packages ' + metric + ' into a decision-ready review card.',
    owner: MODULE.persona
  }));
}

export function createAttributionCockpitReviewPackets() {
  return MODULE.evidenceTypes.map((artifact, index) => ({
    id: MODULE.id + '-packet-' + (index + 1),
    artifact,
    destination: MODULE.groupId + '-leadership',
    summary: MODULE.groupTitle + ' consumes ' + artifact + ' during review cadences.'
  }));
}

export function summarizeAttributionCockpitReporting() {
  const cards = createAttributionCockpitReportCards();
  const packets = createAttributionCockpitReviewPackets();
  return {
    totalCards: cards.length,
    totalPackets: packets.length,
    executiveCards: cards.filter((entry) => entry.audience === 'executive').length
  };
}

