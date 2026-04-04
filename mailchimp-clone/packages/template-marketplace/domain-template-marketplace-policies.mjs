const DEFAULT_POLICIES = [
  { id: 'template-marketplace-policy-1', title: 'Template Marketplace rollout policy', severity: 'medium' },
  { id: 'template-marketplace-policy-2', title: 'Template Marketplace approval policy', severity: 'high' },
  { id: 'template-marketplace-policy-3', title: 'Template Marketplace incident fallback', severity: 'medium' }
];

export function createTemplateMarketplacePolicies(overrides = {}) {
  return DEFAULT_POLICIES.map((policy, index) => ({
    ...policy,
    owner: overrides.owner || 'ops-owner',
    status: overrides.status || (index === 1 ? 'watch' : 'active'),
    controls: ['audit-log', 'seat-review', 'launch-approval'].slice(0, index + 1),
    notes: overrides.notes || 'Template Marketplace policy posture for expansion wave.'
  }));
}

export function validateTemplateMarketplacePolicies(policies = createTemplateMarketplacePolicies()) {
  const issues = [];
  if (policies.length < 3) issues.push('insufficient_policy_depth');
  if (!policies.some((policy) => policy.severity === 'high')) issues.push('missing_high_severity_policy');
  if (!policies.every((policy) => Array.isArray(policy.controls) && policy.controls.length >= 1)) issues.push('policy_controls_missing');
  return {
    ok: issues.length === 0,
    issues,
    policyCount: policies.length
  };
}

export function policySummaryTemplateMarketplace(policies = createTemplateMarketplacePolicies()) {
  return {
    total: policies.length,
    watch: policies.filter((policy) => policy.status === 'watch').length,
    active: policies.filter((policy) => policy.status === 'active').length
  };
}
