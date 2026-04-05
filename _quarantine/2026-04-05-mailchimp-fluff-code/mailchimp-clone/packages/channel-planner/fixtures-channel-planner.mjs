const MODULE = {
  "id": "channel-planner",
  "ordinal": 213,
  "domain": "channel",
  "surfaceId": "planner",
  "surfaceTitle": "Planner",
  "routeSegment": "planner",
  "title": "Channel Planner",
  "focus": "Channel Planner covers channel operating models, readiness coverage, and mix governance through calendar planning and execution choreography.",
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
    "planner",
    "growth",
    "mailchimp-clone-scale-wave-seven"
  ],
  "tags": [
    "channel",
    "planner",
    "growth",
    "channel-planner-wave-seven"
  ]
};

export function createChannelPlannerFixtures() {
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

export function summarizeChannelPlannerFixtures(fixtures = createChannelPlannerFixtures()) {
  return {
    accounts: fixtures.accounts.length,
    contacts: fixtures.contacts.length,
    notes: fixtures.notes.length
  };
}

export function createChannelPlannerDemoInputs() {
  return {
    workspaceName: MODULE.title + ' Demo Workspace',
    owner: MODULE.persona,
    tags: MODULE.tags,
    focus: MODULE.focus
  };
}

