const MODULE = {
  "id": "benchmark-sentinel",
  "ordinal": 156,
  "domain": "benchmark",
  "surfaceId": "sentinel",
  "surfaceTitle": "Sentinel",
  "routeSegment": "sentinel",
  "title": "Benchmark Sentinel",
  "focus": "Benchmark Sentinel covers peer comparisons, maturity tracking, and reference baselines through alerts, anomaly watch, and guardrails.",
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
    "sentinel",
    "revenue",
    "mailchimp-clone-scale-wave-seven"
  ],
  "tags": [
    "benchmark",
    "sentinel",
    "revenue",
    "benchmark-sentinel-wave-seven"
  ]
};

export function createBenchmarkSentinelReportCards() {
  return MODULE.metrics.map((metric, index) => ({
    id: MODULE.id + '-report-' + (index + 1),
    title: MODULE.title + ' ' + metric + ' review',
    audience: index % 2 === 0 ? 'executive' : 'operator',
    summary: MODULE.title + ' packages ' + metric + ' into a decision-ready review card.',
    owner: MODULE.persona
  }));
}

export function createBenchmarkSentinelReviewPackets() {
  return MODULE.evidenceTypes.map((artifact, index) => ({
    id: MODULE.id + '-packet-' + (index + 1),
    artifact,
    destination: MODULE.groupId + '-leadership',
    summary: MODULE.groupTitle + ' consumes ' + artifact + ' during review cadences.'
  }));
}

export function summarizeBenchmarkSentinelReporting() {
  const cards = createBenchmarkSentinelReportCards();
  const packets = createBenchmarkSentinelReviewPackets();
  return {
    totalCards: cards.length,
    totalPackets: packets.length,
    executiveCards: cards.filter((entry) => entry.audience === 'executive').length
  };
}

