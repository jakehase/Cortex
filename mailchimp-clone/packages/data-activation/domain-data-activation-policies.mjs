const DEFAULT_POLICIES = [
  { id: "data-activation-policy-1", title: "Data Activation guardrail", severity: 'medium' },
  { id: "data-activation-policy-2", title: "Data Activation approval ring", severity: 'high' },
  { id: "data-activation-policy-3", title: "Data Activation rollback lane", severity: 'medium' }
];

export function createDataActivationPolicies(overrides = {}) {
  return DEFAULT_POLICIES.map((policy, index) => ({
    ...policy,
    owner: overrides.owner || 'wave6-owner',
    status: overrides.status || (index === 1 ? 'watch' : 'active'),
    controls: ['change-log', 'approval-ring', 'rollback-check'].slice(0, index + 1),
    notes: overrides.notes || "Data Activation policy pack for the real-repo expansion wave."
  }));
}

export function validateDataActivationPolicies(policies = createDataActivationPolicies()) {
  const issues = [];
  if (policies.length < 3) issues.push('insufficient_policy_depth');
  if (!policies.some((policy) => policy.severity === 'high')) issues.push('missing_high_severity_policy');
  if (!policies.every((policy) => policy.controls.length >= 1)) issues.push('missing_controls');
  return { ok: issues.length === 0, issues, policyCount: policies.length };
}

export function policySummaryDataActivation(policies = createDataActivationPolicies()) {
  return { total: policies.length, watch: policies.filter((policy) => policy.status === 'watch').length, active: policies.filter((policy) => policy.status === 'active').length };
}

