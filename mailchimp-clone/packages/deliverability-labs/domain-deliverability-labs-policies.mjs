const DEFAULT_POLICIES = [
  { id: 'deliverability-labs-policy-1', title: 'Deliverability Labs guardrail', severity: 'medium' },
  { id: 'deliverability-labs-policy-2', title: 'Deliverability Labs approval ring', severity: 'high' },
  { id: 'deliverability-labs-policy-3', title: 'Deliverability Labs rollback lane', severity: 'medium' }
];

export function createDeliverabilityLabsPolicies(overrides = {}) {
  return DEFAULT_POLICIES.map((policy, index) => ({
    ...policy,
    owner: overrides.owner || 'continuation-owner',
    status: overrides.status || (index === 1 ? 'watch' : 'active'),
    controls: ['change-log', 'approval-ring', 'rollback-check'].slice(0, index + 1),
    notes: overrides.notes || 'Deliverability Labs policy pack for expansion.'
  }));
}

export function validateDeliverabilityLabsPolicies(policies = createDeliverabilityLabsPolicies()) {
  const issues = [];
  if (policies.length < 3) issues.push('insufficient_policy_depth');
  if (!policies.some((policy) => policy.severity === 'high')) issues.push('missing_high_severity_policy');
  if (!policies.every((policy) => policy.controls.length >= 1)) issues.push('missing_controls');
  return { ok: issues.length === 0, issues, policyCount: policies.length };
}

export function policySummaryDeliverabilityLabs(policies = createDeliverabilityLabsPolicies()) {
  return { total: policies.length, watch: policies.filter((policy) => policy.status === 'watch').length, active: policies.filter((policy) => policy.status === 'active').length };
}
