const DEFAULT_POLICIES = [
  { id: 'social-publisher-policy-1', title: 'Social Publisher guardrail', severity: 'medium' },
  { id: 'social-publisher-policy-2', title: 'Social Publisher approval ring', severity: 'high' },
  { id: 'social-publisher-policy-3', title: 'Social Publisher rollback lane', severity: 'medium' }
];

export function createSocialPublisherPolicies(overrides = {}) {
  return DEFAULT_POLICIES.map((policy, index) => ({
    ...policy,
    owner: overrides.owner || 'continuation-owner',
    status: overrides.status || (index === 1 ? 'watch' : 'active'),
    controls: ['change-log', 'approval-ring', 'rollback-check'].slice(0, index + 1),
    notes: overrides.notes || 'Social Publisher policy pack for expansion.'
  }));
}

export function validateSocialPublisherPolicies(policies = createSocialPublisherPolicies()) {
  const issues = [];
  if (policies.length < 3) issues.push('insufficient_policy_depth');
  if (!policies.some((policy) => policy.severity === 'high')) issues.push('missing_high_severity_policy');
  if (!policies.every((policy) => policy.controls.length >= 1)) issues.push('missing_controls');
  return { ok: issues.length === 0, issues, policyCount: policies.length };
}

export function policySummarySocialPublisher(policies = createSocialPublisherPolicies()) {
  return { total: policies.length, watch: policies.filter((policy) => policy.status === 'watch').length, active: policies.filter((policy) => policy.status === 'active').length };
}
