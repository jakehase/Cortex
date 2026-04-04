const DEFAULT_POLICIES = [
  { id: 'sms-orchestration-policy-1', title: 'Sms Orchestration rollout policy', severity: 'medium' },
  { id: 'sms-orchestration-policy-2', title: 'Sms Orchestration approval policy', severity: 'high' },
  { id: 'sms-orchestration-policy-3', title: 'Sms Orchestration incident fallback', severity: 'medium' }
];

export function createSmsOrchestrationPolicies(overrides = {}) {
  return DEFAULT_POLICIES.map((policy, index) => ({
    ...policy,
    owner: overrides.owner || 'ops-owner',
    status: overrides.status || (index === 1 ? 'watch' : 'active'),
    controls: ['audit-log', 'seat-review', 'launch-approval'].slice(0, index + 1),
    notes: overrides.notes || 'Sms Orchestration policy posture for expansion wave.'
  }));
}

export function validateSmsOrchestrationPolicies(policies = createSmsOrchestrationPolicies()) {
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

export function policySummarySmsOrchestration(policies = createSmsOrchestrationPolicies()) {
  return {
    total: policies.length,
    watch: policies.filter((policy) => policy.status === 'watch').length,
    active: policies.filter((policy) => policy.status === 'active').length
  };
}
