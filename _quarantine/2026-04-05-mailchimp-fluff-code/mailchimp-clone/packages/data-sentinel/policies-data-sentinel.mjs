const MODULE = {
  "id": "data-sentinel",
  "ordinal": 374,
  "domain": "data",
  "surfaceId": "sentinel",
  "surfaceTitle": "Sentinel",
  "routeSegment": "sentinel",
  "title": "Data Sentinel",
  "focus": "Data Sentinel covers pipeline health, lineage, freshness, and operator trust in data assets through alerts, anomaly watch, and guardrails.",
  "descriptor": "pipeline health, lineage, freshness, and operator trust in data assets",
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
    "data",
    "sentinel",
    "intelligence",
    "mailchimp-clone-scale-wave-seven"
  ],
  "tags": [
    "data",
    "sentinel",
    "intelligence",
    "data-sentinel-wave-seven"
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

export function createDataSentinelPolicies(overrides = {}) {
  return BASE_POLICY_SET.map((policy, index) => ({
    ...policy,
    status: overrides.status || (index % 2 === 0 ? 'active' : 'watch'),
    escalation: overrides.escalation || (index % 3 === 0 ? 'director' : 'manager'),
    note: overrides.note || MODULE.title + ' uses ' + policy.control + ' to preserve ' + MODULE.descriptor + '.'
  }));
}

export function validateDataSentinelPolicies(policies = createDataSentinelPolicies()) {
  const issues = [];
  if (policies.length < MODULE.controls.length) issues.push('missing_policy_rows');
  if (!policies.some((policy) => policy.severity === 'high')) issues.push('missing_high_policy');
  if (!policies.every((policy) => policy.evidenceType)) issues.push('missing_evidence_binding');
  return { ok: issues.length === 0, issues, policyCount: policies.length };
}

export function summarizeDataSentinelPolicies(policies = createDataSentinelPolicies()) {
  return {
    total: policies.length,
    active: policies.filter((policy) => policy.status === 'active').length,
    watch: policies.filter((policy) => policy.status === 'watch').length,
    escalations: [...new Set(policies.map((policy) => policy.escalation))]
  };
}

export function createDataSentinelEscalationDeck(policies = createDataSentinelPolicies()) {
  return policies.map((policy, index) => ({
    id: policy.id + '-escalation',
    title: policy.title,
    owner: policy.escalation,
    step: index + 1,
    detail: MODULE.groupTitle + ' keeps a structured escalation path for ' + policy.control + '.'
  }));
}

