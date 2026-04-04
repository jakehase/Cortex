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

const BASE_POLICY_SET = MODULE.controls.map((control, index) => ({
  id: MODULE.id + '-policy-' + (index + 1),
  control,
  title: MODULE.title + ' ' + control.replace(/-/g, ' '),
  severity: index % 3 === 0 ? 'high' : index % 3 === 1 ? 'medium' : 'watch',
  owner: MODULE.persona,
  evidenceType: MODULE.evidenceTypes[index % MODULE.evidenceTypes.length]
}));

export function createAdvocacyAdvisorPolicies(overrides = {}) {
  return BASE_POLICY_SET.map((policy, index) => ({
    ...policy,
    status: overrides.status || (index % 2 === 0 ? 'active' : 'watch'),
    escalation: overrides.escalation || (index % 3 === 0 ? 'director' : 'manager'),
    note: overrides.note || MODULE.title + ' uses ' + policy.control + ' to preserve ' + MODULE.descriptor + '.'
  }));
}

export function validateAdvocacyAdvisorPolicies(policies = createAdvocacyAdvisorPolicies()) {
  const issues = [];
  if (policies.length < MODULE.controls.length) issues.push('missing_policy_rows');
  if (!policies.some((policy) => policy.severity === 'high')) issues.push('missing_high_policy');
  if (!policies.every((policy) => policy.evidenceType)) issues.push('missing_evidence_binding');
  return { ok: issues.length === 0, issues, policyCount: policies.length };
}

export function summarizeAdvocacyAdvisorPolicies(policies = createAdvocacyAdvisorPolicies()) {
  return {
    total: policies.length,
    active: policies.filter((policy) => policy.status === 'active').length,
    watch: policies.filter((policy) => policy.status === 'watch').length,
    escalations: [...new Set(policies.map((policy) => policy.escalation))]
  };
}

export function createAdvocacyAdvisorEscalationDeck(policies = createAdvocacyAdvisorPolicies()) {
  return policies.map((policy, index) => ({
    id: policy.id + '-escalation',
    title: policy.title,
    owner: policy.escalation,
    step: index + 1,
    detail: MODULE.groupTitle + ' keeps a structured escalation path for ' + policy.control + '.'
  }));
}

