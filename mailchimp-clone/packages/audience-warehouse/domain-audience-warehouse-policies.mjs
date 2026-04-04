const DEFAULT_POLICIES = [
  { id: 'audience-warehouse-policy-1', title: 'Audience Warehouse guardrail', severity: 'medium' },
  { id: 'audience-warehouse-policy-2', title: 'Audience Warehouse approval ring', severity: 'high' },
  { id: 'audience-warehouse-policy-3', title: 'Audience Warehouse rollback lane', severity: 'medium' }
];

export function createAudienceWarehousePolicies(overrides = {}) {
  return DEFAULT_POLICIES.map((policy, index) => ({
    ...policy,
    owner: overrides.owner || 'continuation-owner',
    status: overrides.status || (index === 1 ? 'watch' : 'active'),
    controls: ['change-log', 'approval-ring', 'rollback-check'].slice(0, index + 1),
    notes: overrides.notes || 'Audience Warehouse policy pack for expansion.'
  }));
}

export function validateAudienceWarehousePolicies(policies = createAudienceWarehousePolicies()) {
  const issues = [];
  if (policies.length < 3) issues.push('insufficient_policy_depth');
  if (!policies.some((policy) => policy.severity === 'high')) issues.push('missing_high_severity_policy');
  if (!policies.every((policy) => policy.controls.length >= 1)) issues.push('missing_controls');
  return { ok: issues.length === 0, issues, policyCount: policies.length };
}

export function policySummaryAudienceWarehouse(policies = createAudienceWarehousePolicies()) {
  return { total: policies.length, watch: policies.filter((policy) => policy.status === 'watch').length, active: policies.filter((policy) => policy.status === 'active').length };
}
