const DEFAULT_POLICIES = [
  { id: 'referral-engine-policy-1', title: 'Referral Engine rollout policy', severity: 'medium' },
  { id: 'referral-engine-policy-2', title: 'Referral Engine approval policy', severity: 'high' },
  { id: 'referral-engine-policy-3', title: 'Referral Engine incident fallback', severity: 'medium' }
];

export function createReferralEnginePolicies(overrides = {}) {
  return DEFAULT_POLICIES.map((policy, index) => ({
    ...policy,
    owner: overrides.owner || 'ops-owner',
    status: overrides.status || (index === 1 ? 'watch' : 'active'),
    controls: ['audit-log', 'seat-review', 'launch-approval'].slice(0, index + 1),
    notes: overrides.notes || 'Referral Engine policy posture for expansion wave.'
  }));
}

export function validateReferralEnginePolicies(policies = createReferralEnginePolicies()) {
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

export function policySummaryReferralEngine(policies = createReferralEnginePolicies()) {
  return {
    total: policies.length,
    watch: policies.filter((policy) => policy.status === 'watch').length,
    active: policies.filter((policy) => policy.status === 'active').length
  };
}
