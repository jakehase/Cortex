const MODULE = {
  "id": "acquisition-sentinel",
  "ordinal": 16,
  "domain": "acquisition",
  "surfaceId": "sentinel",
  "surfaceTitle": "Sentinel",
  "routeSegment": "sentinel",
  "title": "Acquisition Sentinel",
  "focus": "Acquisition Sentinel covers new demand creation, source quality, and upstream handoff clarity through alerts, anomaly watch, and guardrails.",
  "descriptor": "new demand creation, source quality, and upstream handoff clarity",
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
    "acquisition",
    "sentinel",
    "growth",
    "mailchimp-clone-scale-wave-seven"
  ],
  "tags": [
    "acquisition",
    "sentinel",
    "growth",
    "acquisition-sentinel-wave-seven"
  ]
};

export function createAcquisitionSentinelFixtures() {
  return {
    accounts: [
      { id: MODULE.id + '-acct-1', name: MODULE.title + ' East', tier: 'growth' },
      { id: MODULE.id + '-acct-2', name: MODULE.title + ' West', tier: 'premium' }
    ],
    contacts: [
      { id: MODULE.id + '-contact-1', email: MODULE.id + '+1@example.com', owner: MODULE.persona },
      { id: MODULE.id + '-contact-2', email: MODULE.id + '+2@example.com', owner: MODULE.persona }
    ],
    notes: MODULE.evidenceTypes.map((artifact, index) => MODULE.title + ' fixture note ' + (index + 1) + ' references ' + artifact + '.')
  };
}

export function summarizeAcquisitionSentinelFixtures(fixtures = createAcquisitionSentinelFixtures()) {
  return {
    accounts: fixtures.accounts.length,
    contacts: fixtures.contacts.length,
    notes: fixtures.notes.length
  };
}

export function createAcquisitionSentinelDemoInputs() {
  return {
    workspaceName: MODULE.title + ' Demo Workspace',
    owner: MODULE.persona,
    tags: MODULE.tags,
    focus: MODULE.focus
  };
}

