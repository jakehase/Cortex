const MODULE = {
  "id": "deliverability-workbench",
  "ordinal": 398,
  "domain": "deliverability",
  "surfaceId": "workbench",
  "surfaceTitle": "Workbench",
  "routeSegment": "workbench",
  "title": "Deliverability Workbench",
  "focus": "Deliverability Workbench covers sender health, inbox placement, and response discipline through hands-on workflows and analyst tooling.",
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
    "workbench",
    "lifecycle",
    "mailchimp-clone-scale-wave-seven"
  ],
  "tags": [
    "deliverability",
    "workbench",
    "lifecycle",
    "deliverability-workbench-wave-seven"
  ]
};

export function createDeliverabilityWorkbenchReportCards() {
  return MODULE.metrics.map((metric, index) => ({
    id: MODULE.id + '-report-' + (index + 1),
    title: MODULE.title + ' ' + metric + ' review',
    audience: index % 2 === 0 ? 'executive' : 'operator',
    summary: MODULE.title + ' packages ' + metric + ' into a decision-ready review card.',
    owner: MODULE.persona
  }));
}

export function createDeliverabilityWorkbenchReviewPackets() {
  return MODULE.evidenceTypes.map((artifact, index) => ({
    id: MODULE.id + '-packet-' + (index + 1),
    artifact,
    destination: MODULE.groupId + '-leadership',
    summary: MODULE.groupTitle + ' consumes ' + artifact + ' during review cadences.'
  }));
}

export function summarizeDeliverabilityWorkbenchReporting() {
  const cards = createDeliverabilityWorkbenchReportCards();
  const packets = createDeliverabilityWorkbenchReviewPackets();
  return {
    totalCards: cards.length,
    totalPackets: packets.length,
    executiveCards: cards.filter((entry) => entry.audience === 'executive').length
  };
}

