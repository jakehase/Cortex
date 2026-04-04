const DEFAULT_POLICIES = [
  { id: "customer-health-policy-1", title: "Customer Health guardrail", severity: 'medium' },
  { id: "customer-health-policy-2", title: "Customer Health approval ring", severity: 'high' },
  { id: "customer-health-policy-3", title: "Customer Health rollback lane", severity: 'medium' }
];

export function createCustomerHealthPolicies(overrides = {}) {
  return DEFAULT_POLICIES.map((policy, index) => ({
    ...policy,
    owner: overrides.owner || 'wave6-owner',
    status: overrides.status || (index === 1 ? 'watch' : 'active'),
    controls: ['change-log', 'approval-ring', 'rollback-check'].slice(0, index + 1),
    notes: overrides.notes || "Customer Health policy pack for the real-repo expansion wave."
  }));
}

export function validateCustomerHealthPolicies(policies = createCustomerHealthPolicies()) {
  const issues = [];
  if (policies.length < 3) issues.push('insufficient_policy_depth');
  if (!policies.some((policy) => policy.severity === 'high')) issues.push('missing_high_severity_policy');
  if (!policies.every((policy) => policy.controls.length >= 1)) issues.push('missing_controls');
  return { ok: issues.length === 0, issues, policyCount: policies.length };
}

export function policySummaryCustomerHealth(policies = createCustomerHealthPolicies()) {
  return { total: policies.length, watch: policies.filter((policy) => policy.status === 'watch').length, active: policies.filter((policy) => policy.status === 'active').length };
}

