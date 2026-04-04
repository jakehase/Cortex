const DEFAULT_POLICIES = [
  { id: 'partner-onboarding-policy-1', title: 'Partner Onboarding guardrail', severity: 'medium' },
  { id: 'partner-onboarding-policy-2', title: 'Partner Onboarding approval ring', severity: 'high' },
  { id: 'partner-onboarding-policy-3', title: 'Partner Onboarding rollback lane', severity: 'medium' }
];

export function createPartnerOnboardingPolicies(overrides = {}) {
  return DEFAULT_POLICIES.map((policy, index) => ({
    ...policy,
    owner: overrides.owner || 'continuation-owner',
    status: overrides.status || (index === 1 ? 'watch' : 'active'),
    controls: ['change-log', 'approval-ring', 'rollback-check'].slice(0, index + 1),
    notes: overrides.notes || 'Partner Onboarding policy pack for expansion.'
  }));
}

export function validatePartnerOnboardingPolicies(policies = createPartnerOnboardingPolicies()) {
  const issues = [];
  if (policies.length < 3) issues.push('insufficient_policy_depth');
  if (!policies.some((policy) => policy.severity === 'high')) issues.push('missing_high_severity_policy');
  if (!policies.every((policy) => policy.controls.length >= 1)) issues.push('missing_controls');
  return { ok: issues.length === 0, issues, policyCount: policies.length };
}

export function policySummaryPartnerOnboarding(policies = createPartnerOnboardingPolicies()) {
  return { total: policies.length, watch: policies.filter((policy) => policy.status === 'watch').length, active: policies.filter((policy) => policy.status === 'active').length };
}
