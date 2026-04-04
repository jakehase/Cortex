const DEFAULT_POLICIES = [
  { id: "channel-playbooks-policy-1", title: "Channel Playbooks guardrail", severity: 'medium' },
  { id: "channel-playbooks-policy-2", title: "Channel Playbooks approval ring", severity: 'high' },
  { id: "channel-playbooks-policy-3", title: "Channel Playbooks rollback lane", severity: 'medium' }
];

export function createChannelPlaybooksPolicies(overrides = {}) {
  return DEFAULT_POLICIES.map((policy, index) => ({
    ...policy,
    owner: overrides.owner || 'wave6-owner',
    status: overrides.status || (index === 1 ? 'watch' : 'active'),
    controls: ['change-log', 'approval-ring', 'rollback-check'].slice(0, index + 1),
    notes: overrides.notes || "Channel Playbooks policy pack for the real-repo expansion wave."
  }));
}

export function validateChannelPlaybooksPolicies(policies = createChannelPlaybooksPolicies()) {
  const issues = [];
  if (policies.length < 3) issues.push('insufficient_policy_depth');
  if (!policies.some((policy) => policy.severity === 'high')) issues.push('missing_high_severity_policy');
  if (!policies.every((policy) => policy.controls.length >= 1)) issues.push('missing_controls');
  return { ok: issues.length === 0, issues, policyCount: policies.length };
}

export function policySummaryChannelPlaybooks(policies = createChannelPlaybooksPolicies()) {
  return { total: policies.length, watch: policies.filter((policy) => policy.status === 'watch').length, active: policies.filter((policy) => policy.status === 'active').length };
}

