const MODULE = {
  "id": "integrations-cockpit",
  "ordinal": 461,
  "domain": "integrations",
  "surfaceId": "cockpit",
  "surfaceTitle": "Cockpit",
  "routeSegment": "cockpit",
  "title": "Integrations Cockpit",
  "focus": "Integrations Cockpit covers destination syncs, partner activation, and cross-platform reliability through operator controls and active monitoring.",
  "descriptor": "destination syncs, partner activation, and cross-platform reliability",
  "groupId": "intelligence",
  "groupTitle": "Data, experimentation, and segmentation intelligence",
  "groupDescription": "Analytical workspaces that connect data readiness, experimentation posture, segmentation depth, and attribution signals.",
  "metrics": [
    "freshness",
    "coverage",
    "confidence",
    "throughput",
    "lineage",
    "lift"
  ],
  "lanes": [
    "collect",
    "score",
    "verify",
    "activate",
    "compare",
    "publish"
  ],
  "controls": [
    "lineage-proof",
    "quality-threshold",
    "segment-review",
    "integration-watch",
    "publish-approval",
    "lift-audit"
  ],
  "evidenceTypes": [
    "data-contract",
    "segment-card",
    "experiment-summary",
    "lineage-map",
    "publication-brief",
    "insight-review"
  ],
  "signals": [
    "freshness",
    "lift",
    "match-rate",
    "coverage",
    "confidence",
    "latency"
  ],
  "persona": "analytics program lead",
  "themes": [
    "integrations",
    "cockpit",
    "intelligence",
    "mailchimp-clone-scale-wave-seven"
  ],
  "tags": [
    "integrations",
    "cockpit",
    "intelligence",
    "integrations-cockpit-wave-seven"
  ]
};

export function createIntegrationsCockpitFixtures() {
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

export function summarizeIntegrationsCockpitFixtures(fixtures = createIntegrationsCockpitFixtures()) {
  return {
    accounts: fixtures.accounts.length,
    contacts: fixtures.contacts.length,
    notes: fixtures.notes.length
  };
}

export function createIntegrationsCockpitDemoInputs() {
  return {
    workspaceName: MODULE.title + ' Demo Workspace',
    owner: MODULE.persona,
    tags: MODULE.tags,
    focus: MODULE.focus
  };
}

