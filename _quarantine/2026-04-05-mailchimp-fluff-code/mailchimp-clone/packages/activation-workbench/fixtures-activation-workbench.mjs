const MODULE = {
  "id": "activation-workbench",
  "ordinal": 40,
  "domain": "activation",
  "surfaceId": "workbench",
  "surfaceTitle": "Workbench",
  "routeSegment": "workbench",
  "title": "Activation Workbench",
  "focus": "Activation Workbench covers onboarding readiness, first-value motion, and kickoff momentum through hands-on workflows and analyst tooling.",
  "descriptor": "onboarding readiness, first-value motion, and kickoff momentum",
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
    "activation",
    "workbench",
    "growth",
    "mailchimp-clone-scale-wave-seven"
  ],
  "tags": [
    "activation",
    "workbench",
    "growth",
    "activation-workbench-wave-seven"
  ]
};

export function createActivationWorkbenchFixtures() {
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

export function summarizeActivationWorkbenchFixtures(fixtures = createActivationWorkbenchFixtures()) {
  return {
    accounts: fixtures.accounts.length,
    contacts: fixtures.contacts.length,
    notes: fixtures.notes.length
  };
}

export function createActivationWorkbenchDemoInputs() {
  return {
    workspaceName: MODULE.title + ' Demo Workspace',
    owner: MODULE.persona,
    tags: MODULE.tags,
    focus: MODULE.focus
  };
}

