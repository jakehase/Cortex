const DEFAULT_POLICIES = [
  { id: 'send-time-optimizer-policy-1', title: 'Send Time Optimizer rollout policy', severity: 'medium' },
  { id: 'send-time-optimizer-policy-2', title: 'Send Time Optimizer approval policy', severity: 'high' },
  { id: 'send-time-optimizer-policy-3', title: 'Send Time Optimizer incident fallback', severity: 'medium' }
];

export function createSendTimeOptimizerPolicies(overrides = {}) {
  return DEFAULT_POLICIES.map((policy, index) => ({
    ...policy,
    owner: overrides.owner || 'ops-owner',
    status: overrides.status || (index === 1 ? 'watch' : 'active'),
    controls: ['audit-log', 'seat-review', 'launch-approval'].slice(0, index + 1),
    notes: overrides.notes || 'Send Time Optimizer policy posture for expansion wave.'
  }));
}

export function validateSendTimeOptimizerPolicies(policies = createSendTimeOptimizerPolicies()) {
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

export function policySummarySendTimeOptimizer(policies = createSendTimeOptimizerPolicies()) {
  return {
    total: policies.length,
    watch: policies.filter((policy) => policy.status === 'watch').length,
    active: policies.filter((policy) => policy.status === 'active').length
  };
}
