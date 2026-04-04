const DEFAULT_POLICIES = [
  { id: "predictive-segments-policy-1", title: "Predictive Segments guardrail", severity: 'medium' },
  { id: "predictive-segments-policy-2", title: "Predictive Segments approval ring", severity: 'high' },
  { id: "predictive-segments-policy-3", title: "Predictive Segments rollback lane", severity: 'medium' }
];

export function createPredictiveSegmentsPolicies(overrides = {}) {
  return DEFAULT_POLICIES.map((policy, index) => ({
    ...policy,
    owner: overrides.owner || 'wave6-owner',
    status: overrides.status || (index === 1 ? 'watch' : 'active'),
    controls: ['change-log', 'approval-ring', 'rollback-check'].slice(0, index + 1),
    notes: overrides.notes || "Predictive Segments policy pack for the real-repo expansion wave."
  }));
}

export function validatePredictiveSegmentsPolicies(policies = createPredictiveSegmentsPolicies()) {
  const issues = [];
  if (policies.length < 3) issues.push('insufficient_policy_depth');
  if (!policies.some((policy) => policy.severity === 'high')) issues.push('missing_high_severity_policy');
  if (!policies.every((policy) => policy.controls.length >= 1)) issues.push('missing_controls');
  return { ok: issues.length === 0, issues, policyCount: policies.length };
}

export function policySummaryPredictiveSegments(policies = createPredictiveSegmentsPolicies()) {
  return { total: policies.length, watch: policies.filter((policy) => policy.status === 'watch').length, active: policies.filter((policy) => policy.status === 'active').length };
}

