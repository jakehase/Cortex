const MODULE = {
  "id": "collaboration-watchtower",
  "ordinal": 238,
  "domain": "collaboration",
  "surfaceId": "watchtower",
  "surfaceTitle": "Watchtower",
  "routeSegment": "watchtower",
  "title": "Collaboration Watchtower",
  "focus": "Collaboration Watchtower covers shared ownership, approvals, and cross-functional motion through oversight dashboards and escalation views.",
  "descriptor": "shared ownership, approvals, and cross-functional motion",
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
    "collaboration",
    "watchtower",
    "lifecycle",
    "mailchimp-clone-scale-wave-seven"
  ],
  "tags": [
    "collaboration",
    "watchtower",
    "lifecycle",
    "collaboration-watchtower-wave-seven"
  ]
};

export function createCollaborationWatchtowerReportCards() {
  return MODULE.metrics.map((metric, index) => ({
    id: MODULE.id + '-report-' + (index + 1),
    title: MODULE.title + ' ' + metric + ' review',
    audience: index % 2 === 0 ? 'executive' : 'operator',
    summary: MODULE.title + ' packages ' + metric + ' into a decision-ready review card.',
    owner: MODULE.persona
  }));
}

export function createCollaborationWatchtowerReviewPackets() {
  return MODULE.evidenceTypes.map((artifact, index) => ({
    id: MODULE.id + '-packet-' + (index + 1),
    artifact,
    destination: MODULE.groupId + '-leadership',
    summary: MODULE.groupTitle + ' consumes ' + artifact + ' during review cadences.'
  }));
}

export function summarizeCollaborationWatchtowerReporting() {
  const cards = createCollaborationWatchtowerReportCards();
  const packets = createCollaborationWatchtowerReviewPackets();
  return {
    totalCards: cards.length,
    totalPackets: packets.length,
    executiveCards: cards.filter((entry) => entry.audience === 'executive').length
  };
}

