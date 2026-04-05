const MODULE = {
  "id": "customer-foundry",
  "ordinal": 345,
  "domain": "customer",
  "surfaceId": "foundry",
  "surfaceTitle": "Foundry",
  "routeSegment": "foundry",
  "title": "Customer Foundry",
  "focus": "Customer Foundry covers customer health, account posture, and service motion tracking through program building and surface composition.",
  "descriptor": "customer health, account posture, and service motion tracking",
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
    "customer",
    "foundry",
    "lifecycle",
    "mailchimp-clone-scale-wave-seven"
  ],
  "tags": [
    "customer",
    "foundry",
    "lifecycle",
    "customer-foundry-wave-seven"
  ]
};

export function createCustomerFoundryFixtures() {
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

export function summarizeCustomerFoundryFixtures(fixtures = createCustomerFoundryFixtures()) {
  return {
    accounts: fixtures.accounts.length,
    contacts: fixtures.contacts.length,
    notes: fixtures.notes.length
  };
}

export function createCustomerFoundryDemoInputs() {
  return {
    workspaceName: MODULE.title + ' Demo Workspace',
    owner: MODULE.persona,
    tags: MODULE.tags,
    focus: MODULE.focus
  };
}

