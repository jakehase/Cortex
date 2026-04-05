const MODULE = {
  "id": "advocacy-advisor",
  "ordinal": 41,
  "domain": "advocacy",
  "surfaceId": "advisor",
  "surfaceTitle": "Advisor",
  "routeSegment": "advisor",
  "title": "Advocacy Advisor",
  "focus": "Advocacy Advisor covers customer champions, referral readiness, and proof-sharing loops through recommendations and next-step framing.",
  "descriptor": "customer champions, referral readiness, and proof-sharing loops",
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
    "advocacy",
    "advisor",
    "growth",
    "mailchimp-clone-scale-wave-seven"
  ],
  "tags": [
    "advocacy",
    "advisor",
    "growth",
    "advocacy-advisor-wave-seven"
  ]
};

export function createAdvocacyAdvisorPlaybooks() {
  return MODULE.lanes.map((lane, index) => ({
    id: MODULE.id + '-playbook-' + (index + 1),
    lane,
    title: MODULE.title + ' ' + lane + ' playbook',
    owner: MODULE.persona,
    steps: MODULE.controls.slice(0, 4).map((control, stepIndex) => ({
      id: MODULE.id + '-playbook-' + (index + 1) + '-step-' + (stepIndex + 1),
      control,
      instruction: 'Confirm ' + control + ' before advancing the ' + lane + ' motion.'
    }))
  }));
}

export function createAdvocacyAdvisorDecisionDeck() {
  return MODULE.metrics.map((metric, index) => ({
    id: MODULE.id + '-decision-' + (index + 1),
    metric,
    question: 'Is ' + metric + ' strong enough to advance ' + MODULE.title + '?',
    owner: MODULE.persona,
    recommendation: index % 2 === 0 ? 'advance' : 'watch'
  }));
}

export function createAdvocacyAdvisorEscalationMoments() {
  return MODULE.signals.map((signal, index) => ({
    id: MODULE.id + '-moment-' + (index + 1),
    signal,
    severity: index % 3 === 0 ? 'high' : 'medium',
    note: MODULE.surfaceTitle + ' surfaces ' + signal + ' during high-signal decision points.'
  }));
}

