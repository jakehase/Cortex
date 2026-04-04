const DEFAULT_POLICIES = [
  { id: "retention-offers-policy-1", title: "Retention Offers guardrail", severity: 'medium' },
  { id: "retention-offers-policy-2", title: "Retention Offers approval ring", severity: 'high' },
  { id: "retention-offers-policy-3", title: "Retention Offers rollback lane", severity: 'medium' }
];

export function createRetentionOffersPolicies(overrides = {}) {
  return DEFAULT_POLICIES.map((policy, index) => ({
    ...policy,
    owner: overrides.owner || 'wave6-owner',
    status: overrides.status || (index === 1 ? 'watch' : 'active'),
    controls: ['change-log', 'approval-ring', 'rollback-check'].slice(0, index + 1),
    notes: overrides.notes || "Retention Offers policy pack for the real-repo expansion wave."
  }));
}

export function validateRetentionOffersPolicies(policies = createRetentionOffersPolicies()) {
  const issues = [];
  if (policies.length < 3) issues.push('insufficient_policy_depth');
  if (!policies.some((policy) => policy.severity === 'high')) issues.push('missing_high_severity_policy');
  if (!policies.every((policy) => policy.controls.length >= 1)) issues.push('missing_controls');
  return { ok: issues.length === 0, issues, policyCount: policies.length };
}

export function policySummaryRetentionOffers(policies = createRetentionOffersPolicies()) {
  return { total: policies.length, watch: policies.filter((policy) => policy.status === 'watch').length, active: policies.filter((policy) => policy.status === 'active').length };
}

