const DEFAULT_POLICIES = [
  { id: "trust-automation-policy-1", title: "Trust Automation guardrail", severity: 'medium' },
  { id: "trust-automation-policy-2", title: "Trust Automation approval ring", severity: 'high' },
  { id: "trust-automation-policy-3", title: "Trust Automation rollback lane", severity: 'medium' }
];

export function createTrustAutomationPolicies(overrides = {}) {
  return DEFAULT_POLICIES.map((policy, index) => ({
    ...policy,
    owner: overrides.owner || 'wave6-owner',
    status: overrides.status || (index === 1 ? 'watch' : 'active'),
    controls: ['change-log', 'approval-ring', 'rollback-check'].slice(0, index + 1),
    notes: overrides.notes || "Trust Automation policy pack for the real-repo expansion wave."
  }));
}

export function validateTrustAutomationPolicies(policies = createTrustAutomationPolicies()) {
  const issues = [];
  if (policies.length < 3) issues.push('insufficient_policy_depth');
  if (!policies.some((policy) => policy.severity === 'high')) issues.push('missing_high_severity_policy');
  if (!policies.every((policy) => policy.controls.length >= 1)) issues.push('missing_controls');
  return { ok: issues.length === 0, issues, policyCount: policies.length };
}

export function policySummaryTrustAutomation(policies = createTrustAutomationPolicies()) {
  return { total: policies.length, watch: policies.filter((policy) => policy.status === 'watch').length, active: policies.filter((policy) => policy.status === 'active').length };
}

