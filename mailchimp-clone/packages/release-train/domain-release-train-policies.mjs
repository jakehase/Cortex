const DEFAULT_POLICIES = [
  { id: 'release-train-policy-1', title: 'Release Train guardrail', severity: 'medium' },
  { id: 'release-train-policy-2', title: 'Release Train approval ring', severity: 'high' },
  { id: 'release-train-policy-3', title: 'Release Train rollback lane', severity: 'medium' }
];

export function createReleaseTrainPolicies(overrides = {}) {
  return DEFAULT_POLICIES.map((policy, index) => ({
    ...policy,
    owner: overrides.owner || 'continuation-owner',
    status: overrides.status || (index === 1 ? 'watch' : 'active'),
    controls: ['change-log', 'approval-ring', 'rollback-check'].slice(0, index + 1),
    notes: overrides.notes || 'Release Train policy pack for expansion.'
  }));
}

export function validateReleaseTrainPolicies(policies = createReleaseTrainPolicies()) {
  const issues = [];
  if (policies.length < 3) issues.push('insufficient_policy_depth');
  if (!policies.some((policy) => policy.severity === 'high')) issues.push('missing_high_severity_policy');
  if (!policies.every((policy) => policy.controls.length >= 1)) issues.push('missing_controls');
  return { ok: issues.length === 0, issues, policyCount: policies.length };
}

export function policySummaryReleaseTrain(policies = createReleaseTrainPolicies()) {
  return { total: policies.length, watch: policies.filter((policy) => policy.status === 'watch').length, active: policies.filter((policy) => policy.status === 'active').length };
}
