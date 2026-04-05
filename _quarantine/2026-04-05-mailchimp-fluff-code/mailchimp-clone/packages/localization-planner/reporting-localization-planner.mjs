const MODULE = {
  "id": "localization-planner",
  "ordinal": 512,
  "domain": "localization",
  "surfaceId": "planner",
  "surfaceTitle": "Planner",
  "routeSegment": "planner",
  "title": "Localization Planner",
  "focus": "Localization Planner covers regional readiness, translation coverage, and market-specific proof through calendar planning and execution choreography.",
  "descriptor": "regional readiness, translation coverage, and market-specific proof",
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
    "localization",
    "planner",
    "trust",
    "mailchimp-clone-scale-wave-seven"
  ],
  "tags": [
    "localization",
    "planner",
    "trust",
    "localization-planner-wave-seven"
  ]
};

export function createLocalizationPlannerReportCards() {
  return MODULE.metrics.map((metric, index) => ({
    id: MODULE.id + '-report-' + (index + 1),
    title: MODULE.title + ' ' + metric + ' review',
    audience: index % 2 === 0 ? 'executive' : 'operator',
    summary: MODULE.title + ' packages ' + metric + ' into a decision-ready review card.',
    owner: MODULE.persona
  }));
}

export function createLocalizationPlannerReviewPackets() {
  return MODULE.evidenceTypes.map((artifact, index) => ({
    id: MODULE.id + '-packet-' + (index + 1),
    artifact,
    destination: MODULE.groupId + '-leadership',
    summary: MODULE.groupTitle + ' consumes ' + artifact + ' during review cadences.'
  }));
}

export function summarizeLocalizationPlannerReporting() {
  const cards = createLocalizationPlannerReportCards();
  const packets = createLocalizationPlannerReviewPackets();
  return {
    totalCards: cards.length,
    totalPackets: packets.length,
    executiveCards: cards.filter((entry) => entry.audience === 'executive').length
  };
}

