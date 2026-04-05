const MODULE = {
  "id": "automation-planner",
  "ordinal": 114,
  "domain": "automation",
  "surfaceId": "planner",
  "surfaceTitle": "Planner",
  "routeSegment": "planner",
  "title": "Automation Planner",
  "focus": "Automation Planner covers triggered lifecycle programs, timing controls, and operator confidence through calendar planning and execution choreography.",
  "descriptor": "triggered lifecycle programs, timing controls, and operator confidence",
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
    "automation",
    "planner",
    "lifecycle",
    "mailchimp-clone-scale-wave-seven"
  ],
  "tags": [
    "automation",
    "planner",
    "lifecycle",
    "automation-planner-wave-seven"
  ]
};

export function createAutomationPlannerReportCards() {
  return MODULE.metrics.map((metric, index) => ({
    id: MODULE.id + '-report-' + (index + 1),
    title: MODULE.title + ' ' + metric + ' review',
    audience: index % 2 === 0 ? 'executive' : 'operator',
    summary: MODULE.title + ' packages ' + metric + ' into a decision-ready review card.',
    owner: MODULE.persona
  }));
}

export function createAutomationPlannerReviewPackets() {
  return MODULE.evidenceTypes.map((artifact, index) => ({
    id: MODULE.id + '-packet-' + (index + 1),
    artifact,
    destination: MODULE.groupId + '-leadership',
    summary: MODULE.groupTitle + ' consumes ' + artifact + ' during review cadences.'
  }));
}

export function summarizeAutomationPlannerReporting() {
  const cards = createAutomationPlannerReportCards();
  const packets = createAutomationPlannerReviewPackets();
  return {
    totalCards: cards.length,
    totalPackets: packets.length,
    executiveCards: cards.filter((entry) => entry.audience === 'executive').length
  };
}

