const DEFAULT_POLICIES = [
  { id: "consent-ledger-policy-1", title: "Consent Ledger guardrail", severity: 'medium' },
  { id: "consent-ledger-policy-2", title: "Consent Ledger approval ring", severity: 'high' },
  { id: "consent-ledger-policy-3", title: "Consent Ledger rollback lane", severity: 'medium' }
];

export function createConsentLedgerPolicies(overrides = {}) {
  return DEFAULT_POLICIES.map((policy, index) => ({
    ...policy,
    owner: overrides.owner || 'wave6-owner',
    status: overrides.status || (index === 1 ? 'watch' : 'active'),
    controls: ['change-log', 'approval-ring', 'rollback-check'].slice(0, index + 1),
    notes: overrides.notes || "Consent Ledger policy pack for the real-repo expansion wave."
  }));
}

export function validateConsentLedgerPolicies(policies = createConsentLedgerPolicies()) {
  const issues = [];
  if (policies.length < 3) issues.push('insufficient_policy_depth');
  if (!policies.some((policy) => policy.severity === 'high')) issues.push('missing_high_severity_policy');
  if (!policies.every((policy) => policy.controls.length >= 1)) issues.push('missing_controls');
  return { ok: issues.length === 0, issues, policyCount: policies.length };
}

export function policySummaryConsentLedger(policies = createConsentLedgerPolicies()) {
  return { total: policies.length, watch: policies.filter((policy) => policy.status === 'watch').length, active: policies.filter((policy) => policy.status === 'active').length };
}

