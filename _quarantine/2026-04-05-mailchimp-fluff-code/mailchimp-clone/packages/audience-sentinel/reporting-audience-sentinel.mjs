const MODULE = {
  "id": "audience-sentinel",
  "ordinal": 136,
  "domain": "audience",
  "surfaceId": "sentinel",
  "surfaceTitle": "Sentinel",
  "routeSegment": "sentinel",
  "title": "Audience Sentinel",
  "focus": "Audience Sentinel covers audience health, segment design, and targeting durability through alerts, anomaly watch, and guardrails.",
  "descriptor": "audience health, segment design, and targeting durability",
  "groupId": "growth",
  "groupTitle": "Growth, acquisition, and channel planning",
  "groupDescription": "Portfolio planning surfaces that help teams model demand creation, audience readiness, channel pacing, and conversion posture.",
  "metrics": [
    "coverage",
    "velocity",
    "pipeline",
    "adoption",
    "conversion",
    "efficiency"
  ],
  "lanes": [
    "plan",
    "prioritize",
    "launch",
    "stabilize",
    "review",
    "scale"
  ],
  "controls": [
    "budget-fence",
    "targeting-review",
    "handoff-check",
    "qa-ready",
    "launch-approval",
    "post-launch-retro"
  ],
  "evidenceTypes": [
    "brief",
    "launch-log",
    "coverage-map",
    "experiment-report",
    "handoff-packet",
    "weekly-summary"
  ],
  "signals": [
    "reach",
    "response",
    "conversion",
    "lift",
    "handoff",
    "risk"
  ],
  "persona": "growth lead",
  "themes": [
    "audience",
    "sentinel",
    "growth",
    "mailchimp-clone-scale-wave-seven"
  ],
  "tags": [
    "audience",
    "sentinel",
    "growth",
    "audience-sentinel-wave-seven"
  ]
};

export function createAudienceSentinelReportCards() {
  return MODULE.metrics.map((metric, index) => ({
    id: MODULE.id + '-report-' + (index + 1),
    title: MODULE.title + ' ' + metric + ' review',
    audience: index % 2 === 0 ? 'executive' : 'operator',
    summary: MODULE.title + ' packages ' + metric + ' into a decision-ready review card.',
    owner: MODULE.persona
  }));
}

export function createAudienceSentinelReviewPackets() {
  return MODULE.evidenceTypes.map((artifact, index) => ({
    id: MODULE.id + '-packet-' + (index + 1),
    artifact,
    destination: MODULE.groupId + '-leadership',
    summary: MODULE.groupTitle + ' consumes ' + artifact + ' during review cadences.'
  }));
}

export function summarizeAudienceSentinelReporting() {
  const cards = createAudienceSentinelReportCards();
  const packets = createAudienceSentinelReviewPackets();
  return {
    totalCards: cards.length,
    totalPackets: packets.length,
    executiveCards: cards.filter((entry) => entry.audience === 'executive').length
  };
}

