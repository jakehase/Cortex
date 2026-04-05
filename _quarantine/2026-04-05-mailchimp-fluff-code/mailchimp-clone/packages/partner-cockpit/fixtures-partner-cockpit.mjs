const MODULE = {
  "id": "partner-cockpit",
  "ordinal": 540,
  "domain": "partner",
  "surfaceId": "cockpit",
  "surfaceTitle": "Cockpit",
  "routeSegment": "cockpit",
  "title": "Partner Cockpit",
  "focus": "Partner Cockpit covers partner readiness, enablement continuity, and ecosystem execution through operator controls and active monitoring.",
  "descriptor": "partner readiness, enablement continuity, and ecosystem execution",
  "groupId": "trust",
  "groupTitle": "Trust, compliance, and partner governance",
  "groupDescription": "Governance surfaces that keep regional requirements, audit evidence, partner operations, and trust posture visible.",
  "metrics": [
    "coverage",
    "exceptions",
    "sla",
    "proof",
    "regionality",
    "resolution"
  ],
  "lanes": [
    "detect",
    "triage",
    "remediate",
    "verify",
    "attest",
    "archive"
  ],
  "controls": [
    "evidence-lock",
    "regional-review",
    "policy-gate",
    "remediation-sla",
    "partner-attest",
    "release-hold"
  ],
  "evidenceTypes": [
    "audit-log",
    "attestation",
    "proof-chain",
    "policy-pack",
    "regional-report",
    "exception-summary"
  ],
  "signals": [
    "risk",
    "proof",
    "region",
    "exception",
    "attestation",
    "hold"
  ],
  "persona": "trust program owner",
  "themes": [
    "partner",
    "cockpit",
    "trust",
    "mailchimp-clone-scale-wave-seven"
  ],
  "tags": [
    "partner",
    "cockpit",
    "trust",
    "partner-cockpit-wave-seven"
  ]
};

export function createPartnerCockpitFixtures() {
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

export function summarizePartnerCockpitFixtures(fixtures = createPartnerCockpitFixtures()) {
  return {
    accounts: fixtures.accounts.length,
    contacts: fixtures.contacts.length,
    notes: fixtures.notes.length
  };
}

export function createPartnerCockpitDemoInputs() {
  return {
    workspaceName: MODULE.title + ' Demo Workspace',
    owner: MODULE.persona,
    tags: MODULE.tags,
    focus: MODULE.focus
  };
}

