const DEFAULT_POLICIES = [
  { id: 'commerce-coupons-policy-1', title: 'Commerce Coupons guardrail', severity: 'medium' },
  { id: 'commerce-coupons-policy-2', title: 'Commerce Coupons approval ring', severity: 'high' },
  { id: 'commerce-coupons-policy-3', title: 'Commerce Coupons rollback lane', severity: 'medium' }
];

export function createCommerceCouponsPolicies(overrides = {}) {
  return DEFAULT_POLICIES.map((policy, index) => ({
    ...policy,
    owner: overrides.owner || 'continuation-owner',
    status: overrides.status || (index === 1 ? 'watch' : 'active'),
    controls: ['change-log', 'approval-ring', 'rollback-check'].slice(0, index + 1),
    notes: overrides.notes || 'Commerce Coupons policy pack for expansion.'
  }));
}

export function validateCommerceCouponsPolicies(policies = createCommerceCouponsPolicies()) {
  const issues = [];
  if (policies.length < 3) issues.push('insufficient_policy_depth');
  if (!policies.some((policy) => policy.severity === 'high')) issues.push('missing_high_severity_policy');
  if (!policies.every((policy) => policy.controls.length >= 1)) issues.push('missing_controls');
  return { ok: issues.length === 0, issues, policyCount: policies.length };
}

export function policySummaryCommerceCoupons(policies = createCommerceCouponsPolicies()) {
  return { total: policies.length, watch: policies.filter((policy) => policy.status === 'watch').length, active: policies.filter((policy) => policy.status === 'active').length };
}
