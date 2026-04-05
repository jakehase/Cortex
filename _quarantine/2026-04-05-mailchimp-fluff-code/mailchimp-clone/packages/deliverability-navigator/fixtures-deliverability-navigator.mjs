const MODULE = {
  "id": "deliverability-navigator",
  "ordinal": 390,
  "domain": "deliverability",
  "surfaceId": "navigator",
  "surfaceTitle": "Navigator",
  "routeSegment": "navigator",
  "title": "Deliverability Navigator",
  "focus": "Deliverability Navigator covers sender health, inbox placement, and response discipline through journey guidance and directional controls.",
  "descriptor": "sender health, inbox placement, and response discipline",
  "groupId": "lifecycle",
  "groupTitle": "Lifecycle, customer success, and messaging durability",
  "groupDescription": "Customer lifecycle surfaces spanning automation, retention, support, subscriptions, surveys, and deliverability operations.",
  "metrics": [
    "health",
    "retention",
    "response",
    "satisfaction",
    "deliverability",
    "durability"
  ],
  "lanes": [
    "observe",
    "coordinate",
    "assist",
    "resolve",
    "measure",
    "expand"
  ],
  "controls": [
    "response-sla",
    "journey-check",
    "approval-ring",
    "delivery-guard",
    "satisfaction-review",
    "recovery-kit"
  ],
  "evidenceTypes": [
    "journey-log",
    "service-brief",
    "response-matrix",
    "delivery-summary",
    "retention-pack",
    "experience-scorecard"
  ],
  "signals": [
    "health",
    "sentiment",
    "recovery",
    "sla",
    "delivery",
    "retention"
  ],
  "persona": "lifecycle operations lead",
  "themes": [
    "deliverability",
    "navigator",
    "lifecycle",
    "mailchimp-clone-scale-wave-seven"
  ],
  "tags": [
    "deliverability",
    "navigator",
    "lifecycle",
    "deliverability-navigator-wave-seven"
  ]
};

export function createDeliverabilityNavigatorFixtures() {
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

export function summarizeDeliverabilityNavigatorFixtures(fixtures = createDeliverabilityNavigatorFixtures()) {
  return {
    accounts: fixtures.accounts.length,
    contacts: fixtures.contacts.length,
    notes: fixtures.notes.length
  };
}

export function createDeliverabilityNavigatorDemoInputs() {
  return {
    workspaceName: MODULE.title + ' Demo Workspace',
    owner: MODULE.persona,
    tags: MODULE.tags,
    focus: MODULE.focus
  };
}

