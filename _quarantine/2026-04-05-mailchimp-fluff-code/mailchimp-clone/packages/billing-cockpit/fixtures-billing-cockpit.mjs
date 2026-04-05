const MODULE = {
  "id": "billing-cockpit",
  "ordinal": 162,
  "domain": "billing",
  "surfaceId": "cockpit",
  "surfaceTitle": "Cockpit",
  "routeSegment": "cockpit",
  "title": "Billing Cockpit",
  "focus": "Billing Cockpit covers plan posture, invoice exceptions, and collection readiness through operator controls and active monitoring.",
  "descriptor": "plan posture, invoice exceptions, and collection readiness",
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
    "billing",
    "cockpit",
    "revenue",
    "mailchimp-clone-scale-wave-seven"
  ],
  "tags": [
    "billing",
    "cockpit",
    "revenue",
    "billing-cockpit-wave-seven"
  ]
};

export function createBillingCockpitFixtures() {
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

export function summarizeBillingCockpitFixtures(fixtures = createBillingCockpitFixtures()) {
  return {
    accounts: fixtures.accounts.length,
    contacts: fixtures.contacts.length,
    notes: fixtures.notes.length
  };
}

export function createBillingCockpitDemoInputs() {
  return {
    workspaceName: MODULE.title + ' Demo Workspace',
    owner: MODULE.persona,
    tags: MODULE.tags,
    focus: MODULE.focus
  };
}

