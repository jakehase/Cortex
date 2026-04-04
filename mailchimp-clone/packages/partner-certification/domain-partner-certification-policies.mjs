const DEFAULT_POLICIES = [
  { id: "partner-certification-policy-1", title: "Partner Certification guardrail", severity: 'medium' },
  { id: "partner-certification-policy-2", title: "Partner Certification approval ring", severity: 'high' },
  { id: "partner-certification-policy-3", title: "Partner Certification rollback lane", severity: 'medium' }
];

export function createPartnerCertificationPolicies(overrides = {}) {
  return DEFAULT_POLICIES.map((policy, index) => ({
    ...policy,
    owner: overrides.owner || 'wave6-owner',
    status: overrides.status || (index === 1 ? 'watch' : 'active'),
    controls: ['change-log', 'approval-ring', 'rollback-check'].slice(0, index + 1),
    notes: overrides.notes || "Partner Certification policy pack for the real-repo expansion wave."
  }));
}

export function validatePartnerCertificationPolicies(policies = createPartnerCertificationPolicies()) {
  const issues = [];
  if (policies.length < 3) issues.push('insufficient_policy_depth');
  if (!policies.some((policy) => policy.severity === 'high')) issues.push('missing_high_severity_policy');
  if (!policies.every((policy) => policy.controls.length >= 1)) issues.push('missing_controls');
  return { ok: issues.length === 0, issues, policyCount: policies.length };
}

export function policySummaryPartnerCertification(policies = createPartnerCertificationPolicies()) {
  return { total: policies.length, watch: policies.filter((policy) => policy.status === 'watch').length, active: policies.filter((policy) => policy.status === 'active').length };
}

