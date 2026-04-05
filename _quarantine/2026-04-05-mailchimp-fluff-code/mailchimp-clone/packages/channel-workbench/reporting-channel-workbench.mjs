const MODULE = {
  "id": "channel-workbench",
  "ordinal": 219,
  "domain": "channel",
  "surfaceId": "workbench",
  "surfaceTitle": "Workbench",
  "routeSegment": "workbench",
  "title": "Channel Workbench",
  "focus": "Channel Workbench covers channel operating models, readiness coverage, and mix governance through hands-on workflows and analyst tooling.",
  "descriptor": "channel operating models, readiness coverage, and mix governance",
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
    "channel",
    "workbench",
    "growth",
    "mailchimp-clone-scale-wave-seven"
  ],
  "tags": [
    "channel",
    "workbench",
    "growth",
    "channel-workbench-wave-seven"
  ]
};

export function createChannelWorkbenchReportCards() {
  return MODULE.metrics.map((metric, index) => ({
    id: MODULE.id + '-report-' + (index + 1),
    title: MODULE.title + ' ' + metric + ' review',
    audience: index % 2 === 0 ? 'executive' : 'operator',
    summary: MODULE.title + ' packages ' + metric + ' into a decision-ready review card.',
    owner: MODULE.persona
  }));
}

export function createChannelWorkbenchReviewPackets() {
  return MODULE.evidenceTypes.map((artifact, index) => ({
    id: MODULE.id + '-packet-' + (index + 1),
    artifact,
    destination: MODULE.groupId + '-leadership',
    summary: MODULE.groupTitle + ' consumes ' + artifact + ' during review cadences.'
  }));
}

export function summarizeChannelWorkbenchReporting() {
  const cards = createChannelWorkbenchReportCards();
  const packets = createChannelWorkbenchReviewPackets();
  return {
    totalCards: cards.length,
    totalPackets: packets.length,
    executiveCards: cards.filter((entry) => entry.audience === 'executive').length
  };
}

