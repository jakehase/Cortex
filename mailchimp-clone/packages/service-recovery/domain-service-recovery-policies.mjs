const DEFAULT_POLICIES = [
  { id: "service-recovery-policy-1", title: "Service Recovery guardrail", severity: 'medium' },
  { id: "service-recovery-policy-2", title: "Service Recovery approval ring", severity: 'high' },
  { id: "service-recovery-policy-3", title: "Service Recovery rollback lane", severity: 'medium' }
];

export function createServiceRecoveryPolicies(overrides = {}) {
  return DEFAULT_POLICIES.map((policy, index) => ({
    ...policy,
    owner: overrides.owner || 'wave6-owner',
    status: overrides.status || (index === 1 ? 'watch' : 'active'),
    controls: ['change-log', 'approval-ring', 'rollback-check'].slice(0, index + 1),
    notes: overrides.notes || "Service Recovery policy pack for the real-repo expansion wave."
  }));
}

export function validateServiceRecoveryPolicies(policies = createServiceRecoveryPolicies()) {
  const issues = [];
  if (policies.length < 3) issues.push('insufficient_policy_depth');
  if (!policies.some((policy) => policy.severity === 'high')) issues.push('missing_high_severity_policy');
  if (!policies.every((policy) => policy.controls.length >= 1)) issues.push('missing_controls');
  return { ok: issues.length === 0, issues, policyCount: policies.length };
}

export function policySummaryServiceRecovery(policies = createServiceRecoveryPolicies()) {
  return { total: policies.length, watch: policies.filter((policy) => policy.status === 'watch').length, active: policies.filter((policy) => policy.status === 'active').length };
}

