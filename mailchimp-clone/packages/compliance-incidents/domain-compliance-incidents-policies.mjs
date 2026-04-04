const DEFAULT_POLICIES = [
  { id: "compliance-incidents-policy-1", title: "Compliance Incidents guardrail", severity: 'medium' },
  { id: "compliance-incidents-policy-2", title: "Compliance Incidents approval ring", severity: 'high' },
  { id: "compliance-incidents-policy-3", title: "Compliance Incidents rollback lane", severity: 'medium' }
];

export function createComplianceIncidentsPolicies(overrides = {}) {
  return DEFAULT_POLICIES.map((policy, index) => ({
    ...policy,
    owner: overrides.owner || 'wave6-owner',
    status: overrides.status || (index === 1 ? 'watch' : 'active'),
    controls: ['change-log', 'approval-ring', 'rollback-check'].slice(0, index + 1),
    notes: overrides.notes || "Compliance Incidents policy pack for the real-repo expansion wave."
  }));
}

export function validateComplianceIncidentsPolicies(policies = createComplianceIncidentsPolicies()) {
  const issues = [];
  if (policies.length < 3) issues.push('insufficient_policy_depth');
  if (!policies.some((policy) => policy.severity === 'high')) issues.push('missing_high_severity_policy');
  if (!policies.every((policy) => policy.controls.length >= 1)) issues.push('missing_controls');
  return { ok: issues.length === 0, issues, policyCount: policies.length };
}

export function policySummaryComplianceIncidents(policies = createComplianceIncidentsPolicies()) {
  return { total: policies.length, watch: policies.filter((policy) => policy.status === 'watch').length, active: policies.filter((policy) => policy.status === 'active').length };
}

