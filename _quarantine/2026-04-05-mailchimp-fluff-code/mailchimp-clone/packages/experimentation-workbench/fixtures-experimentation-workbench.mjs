const MODULE = {
  "id": "experimentation-workbench",
  "ordinal": 438,
  "domain": "experimentation",
  "surfaceId": "workbench",
  "surfaceTitle": "Workbench",
  "routeSegment": "workbench",
  "title": "Experimentation Workbench",
  "focus": "Experimentation Workbench covers test planning, variant analysis, and decision velocity through hands-on workflows and analyst tooling.",
  "descriptor": "test planning, variant analysis, and decision velocity",
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
    "experimentation",
    "workbench",
    "intelligence",
    "mailchimp-clone-scale-wave-seven"
  ],
  "tags": [
    "experimentation",
    "workbench",
    "intelligence",
    "experimentation-workbench-wave-seven"
  ]
};

export function createExperimentationWorkbenchFixtures() {
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

export function summarizeExperimentationWorkbenchFixtures(fixtures = createExperimentationWorkbenchFixtures()) {
  return {
    accounts: fixtures.accounts.length,
    contacts: fixtures.contacts.length,
    notes: fixtures.notes.length
  };
}

export function createExperimentationWorkbenchDemoInputs() {
  return {
    workspaceName: MODULE.title + ' Demo Workspace',
    owner: MODULE.persona,
    tags: MODULE.tags,
    focus: MODULE.focus
  };
}

