const DEFAULT_POLICIES = [
  { id: "sender-rotation-policy-1", title: "Sender Rotation guardrail", severity: 'medium' },
  { id: "sender-rotation-policy-2", title: "Sender Rotation approval ring", severity: 'high' },
  { id: "sender-rotation-policy-3", title: "Sender Rotation rollback lane", severity: 'medium' }
];

export function createSenderRotationPolicies(overrides = {}) {
  return DEFAULT_POLICIES.map((policy, index) => ({
    ...policy,
    owner: overrides.owner || 'wave6-owner',
    status: overrides.status || (index === 1 ? 'watch' : 'active'),
    controls: ['change-log', 'approval-ring', 'rollback-check'].slice(0, index + 1),
    notes: overrides.notes || "Sender Rotation policy pack for the real-repo expansion wave."
  }));
}

export function validateSenderRotationPolicies(policies = createSenderRotationPolicies()) {
  const issues = [];
  if (policies.length < 3) issues.push('insufficient_policy_depth');
  if (!policies.some((policy) => policy.severity === 'high')) issues.push('missing_high_severity_policy');
  if (!policies.every((policy) => policy.controls.length >= 1)) issues.push('missing_controls');
  return { ok: issues.length === 0, issues, policyCount: policies.length };
}

export function policySummarySenderRotation(policies = createSenderRotationPolicies()) {
  return { total: policies.length, watch: policies.filter((policy) => policy.status === 'watch').length, active: policies.filter((policy) => policy.status === 'active').length };
}

