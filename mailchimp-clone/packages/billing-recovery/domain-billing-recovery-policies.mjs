const DEFAULT_POLICIES = [
  { id: 'billing-recovery-policy-1', title: 'Billing Recovery guardrail', severity: 'medium' },
  { id: 'billing-recovery-policy-2', title: 'Billing Recovery approval ring', severity: 'high' },
  { id: 'billing-recovery-policy-3', title: 'Billing Recovery rollback lane', severity: 'medium' }
];

export function createBillingRecoveryPolicies(overrides = {}) {
  return DEFAULT_POLICIES.map((policy, index) => ({
    ...policy,
    owner: overrides.owner || 'continuation-owner',
    status: overrides.status || (index === 1 ? 'watch' : 'active'),
    controls: ['change-log', 'approval-ring', 'rollback-check'].slice(0, index + 1),
    notes: overrides.notes || 'Billing Recovery policy pack for expansion.'
  }));
}

export function validateBillingRecoveryPolicies(policies = createBillingRecoveryPolicies()) {
  const issues = [];
  if (policies.length < 3) issues.push('insufficient_policy_depth');
  if (!policies.some((policy) => policy.severity === 'high')) issues.push('missing_high_severity_policy');
  if (!policies.every((policy) => policy.controls.length >= 1)) issues.push('missing_controls');
  return { ok: issues.length === 0, issues, policyCount: policies.length };
}

export function policySummaryBillingRecovery(policies = createBillingRecoveryPolicies()) {
  return { total: policies.length, watch: policies.filter((policy) => policy.status === 'watch').length, active: policies.filter((policy) => policy.status === 'active').length };
}
