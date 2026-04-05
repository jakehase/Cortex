const MODULE = {
  "id": "campaign-planner",
  "ordinal": 193,
  "domain": "campaign",
  "surfaceId": "planner",
  "surfaceTitle": "Planner",
  "routeSegment": "planner",
  "title": "Campaign Planner",
  "focus": "Campaign Planner covers campaign planning, milestone choreography, and launch readiness through calendar planning and execution choreography.",
  "descriptor": "campaign planning, milestone choreography, and launch readiness",
  "groupId": "growth",
  "groupTitle": "Growth, acquisition, and channel planning",
  "groupDescription": "Portfolio planning surfaces that help teams model demand creation, audience readiness, channel pacing, and conversion posture.",
  "metrics": [
    "coverage",
    "velocity",
    "pipeline",
    "adoption",
    "conversion",
    "efficiency"
  ],
  "lanes": [
    "plan",
    "prioritize",
    "launch",
    "stabilize",
    "review",
    "scale"
  ],
  "controls": [
    "budget-fence",
    "targeting-review",
    "handoff-check",
    "qa-ready",
    "launch-approval",
    "post-launch-retro"
  ],
  "evidenceTypes": [
    "brief",
    "launch-log",
    "coverage-map",
    "experiment-report",
    "handoff-packet",
    "weekly-summary"
  ],
  "signals": [
    "reach",
    "response",
    "conversion",
    "lift",
    "handoff",
    "risk"
  ],
  "persona": "growth lead",
  "themes": [
    "campaign",
    "planner",
    "growth",
    "mailchimp-clone-scale-wave-seven"
  ],
  "tags": [
    "campaign",
    "planner",
    "growth",
    "campaign-planner-wave-seven"
  ]
};

export function createCampaignPlannerOperationsBoard() {
  return MODULE.lanes.map((lane, index) => ({
    id: MODULE.id + '-ops-' + (index + 1),
    lane,
    shift: index % 2 === 0 ? 'day' : 'swing',
    owner: MODULE.persona,
    readiness: index % 3 === 0 ? 'go' : index % 3 === 1 ? 'watch' : 'ready',
    detail: MODULE.title + ' uses the ' + lane + ' lane to coordinate scale-wave-seven operations.'
  }));
}

export function createCampaignPlannerShiftChecklist() {
  return MODULE.controls.map((control, index) => ({
    id: MODULE.id + '-check-' + (index + 1),
    control,
    required: true,
    ok: index !== MODULE.controls.length - 1,
    note: MODULE.groupTitle + ' shift checklist requires ' + control + ' before handoff.'
  }));
}

export function createCampaignPlannerIncidentDeck() {
  return MODULE.evidenceTypes.map((artifact, index) => ({
    id: MODULE.id + '-incident-' + (index + 1),
    artifact,
    severity: index % 3 === 0 ? 'high' : 'medium',
    responseOwner: MODULE.persona,
    note: MODULE.title + ' can bind ' + artifact + ' evidence during escalations.'
  }));
}

