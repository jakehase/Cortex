const MODULE = {
  "id": "insights-ledger",
  "ordinal": 449,
  "domain": "insights",
  "surfaceId": "ledger",
  "surfaceTitle": "Ledger",
  "routeSegment": "ledger",
  "title": "Insights Ledger",
  "focus": "Insights Ledger covers insight synthesis, operating narratives, and executive-ready summaries through audit history and change accountability.",
  "descriptor": "insight synthesis, operating narratives, and executive-ready summaries",
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
    "insights",
    "ledger",
    "revenue",
    "mailchimp-clone-scale-wave-seven"
  ],
  "tags": [
    "insights",
    "ledger",
    "revenue",
    "insights-ledger-wave-seven"
  ]
};

export function createInsightsLedgerFixtures() {
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

export function summarizeInsightsLedgerFixtures(fixtures = createInsightsLedgerFixtures()) {
  return {
    accounts: fixtures.accounts.length,
    contacts: fixtures.contacts.length,
    notes: fixtures.notes.length
  };
}

export function createInsightsLedgerDemoInputs() {
  return {
    workspaceName: MODULE.title + ' Demo Workspace',
    owner: MODULE.persona,
    tags: MODULE.tags,
    focus: MODULE.focus
  };
}

