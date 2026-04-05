const MODULE = {
  "id": "ecommerce-exchange",
  "ordinal": 404,
  "domain": "ecommerce",
  "surfaceId": "exchange",
  "surfaceTitle": "Exchange",
  "routeSegment": "exchange",
  "title": "Ecommerce Exchange",
  "focus": "Ecommerce Exchange covers order behavior, purchase flow posture, and commerce retention signals through handoff workflows and partner coordination.",
  "descriptor": "order behavior, purchase flow posture, and commerce retention signals",
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
    "ecommerce",
    "exchange",
    "revenue",
    "mailchimp-clone-scale-wave-seven"
  ],
  "tags": [
    "ecommerce",
    "exchange",
    "revenue",
    "ecommerce-exchange-wave-seven"
  ]
};

export function createEcommerceExchangeFixtures() {
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

export function summarizeEcommerceExchangeFixtures(fixtures = createEcommerceExchangeFixtures()) {
  return {
    accounts: fixtures.accounts.length,
    contacts: fixtures.contacts.length,
    notes: fixtures.notes.length
  };
}

export function createEcommerceExchangeDemoInputs() {
  return {
    workspaceName: MODULE.title + ' Demo Workspace',
    owner: MODULE.persona,
    tags: MODULE.tags,
    focus: MODULE.focus
  };
}

