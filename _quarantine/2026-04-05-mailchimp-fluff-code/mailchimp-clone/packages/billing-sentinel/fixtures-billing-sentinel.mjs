const MODULE = {
  "id": "billing-sentinel",
  "ordinal": 175,
  "domain": "billing",
  "surfaceId": "sentinel",
  "surfaceTitle": "Sentinel",
  "routeSegment": "sentinel",
  "title": "Billing Sentinel",
  "focus": "Billing Sentinel covers plan posture, invoice exceptions, and collection readiness through alerts, anomaly watch, and guardrails.",
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
    "sentinel",
    "revenue",
    "mailchimp-clone-scale-wave-seven"
  ],
  "tags": [
    "billing",
    "sentinel",
    "revenue",
    "billing-sentinel-wave-seven"
  ]
};

export function createBillingSentinelFixtures() {
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

export function summarizeBillingSentinelFixtures(fixtures = createBillingSentinelFixtures()) {
  return {
    accounts: fixtures.accounts.length,
    contacts: fixtures.contacts.length,
    notes: fixtures.notes.length
  };
}

export function createBillingSentinelDemoInputs() {
  return {
    workspaceName: MODULE.title + ' Demo Workspace',
    owner: MODULE.persona,
    tags: MODULE.tags,
    focus: MODULE.focus
  };
}

