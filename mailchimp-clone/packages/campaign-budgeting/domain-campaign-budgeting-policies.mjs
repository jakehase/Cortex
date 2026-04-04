const DEFAULT_POLICIES = [
  { id: 'campaign-budgeting-policy-1', title: 'Campaign Budgeting guardrail', severity: 'medium' },
  { id: 'campaign-budgeting-policy-2', title: 'Campaign Budgeting approval ring', severity: 'high' },
  { id: 'campaign-budgeting-policy-3', title: 'Campaign Budgeting rollback lane', severity: 'medium' }
];

export function createCampaignBudgetingPolicies(overrides = {}) {
  return DEFAULT_POLICIES.map((policy, index) => ({
    ...policy,
    owner: overrides.owner || 'continuation-owner',
    status: overrides.status || (index === 1 ? 'watch' : 'active'),
    controls: ['change-log', 'approval-ring', 'rollback-check'].slice(0, index + 1),
    notes: overrides.notes || 'Campaign Budgeting policy pack for expansion.'
  }));
}

export function validateCampaignBudgetingPolicies(policies = createCampaignBudgetingPolicies()) {
  const issues = [];
  if (policies.length < 3) issues.push('insufficient_policy_depth');
  if (!policies.some((policy) => policy.severity === 'high')) issues.push('missing_high_severity_policy');
  if (!policies.every((policy) => policy.controls.length >= 1)) issues.push('missing_controls');
  return { ok: issues.length === 0, issues, policyCount: policies.length };
}

export function policySummaryCampaignBudgeting(policies = createCampaignBudgetingPolicies()) {
  return { total: policies.length, watch: policies.filter((policy) => policy.status === 'watch').length, active: policies.filter((policy) => policy.status === 'active').length };
}
