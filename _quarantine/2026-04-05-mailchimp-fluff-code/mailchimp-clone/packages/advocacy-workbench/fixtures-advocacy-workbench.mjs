const MODULE = {
  "id": "advocacy-workbench",
  "ordinal": 60,
  "domain": "advocacy",
  "surfaceId": "workbench",
  "surfaceTitle": "Workbench",
  "routeSegment": "workbench",
  "title": "Advocacy Workbench",
  "focus": "Advocacy Workbench covers customer champions, referral readiness, and proof-sharing loops through hands-on workflows and analyst tooling.",
  "descriptor": "customer champions, referral readiness, and proof-sharing loops",
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
    "advocacy",
    "workbench",
    "growth",
    "mailchimp-clone-scale-wave-seven"
  ],
  "tags": [
    "advocacy",
    "workbench",
    "growth",
    "advocacy-workbench-wave-seven"
  ]
};

export function createAdvocacyWorkbenchFixtures() {
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

export function summarizeAdvocacyWorkbenchFixtures(fixtures = createAdvocacyWorkbenchFixtures()) {
  return {
    accounts: fixtures.accounts.length,
    contacts: fixtures.contacts.length,
    notes: fixtures.notes.length
  };
}

export function createAdvocacyWorkbenchDemoInputs() {
  return {
    workspaceName: MODULE.title + ' Demo Workspace',
    owner: MODULE.persona,
    tags: MODULE.tags,
    focus: MODULE.focus
  };
}

