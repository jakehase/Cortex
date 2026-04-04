const DEFAULT_POLICIES = [
  { id: "template-variants-policy-1", title: "Template Variants guardrail", severity: 'medium' },
  { id: "template-variants-policy-2", title: "Template Variants approval ring", severity: 'high' },
  { id: "template-variants-policy-3", title: "Template Variants rollback lane", severity: 'medium' }
];

export function createTemplateVariantsPolicies(overrides = {}) {
  return DEFAULT_POLICIES.map((policy, index) => ({
    ...policy,
    owner: overrides.owner || 'wave6-owner',
    status: overrides.status || (index === 1 ? 'watch' : 'active'),
    controls: ['change-log', 'approval-ring', 'rollback-check'].slice(0, index + 1),
    notes: overrides.notes || "Template Variants policy pack for the real-repo expansion wave."
  }));
}

export function validateTemplateVariantsPolicies(policies = createTemplateVariantsPolicies()) {
  const issues = [];
  if (policies.length < 3) issues.push('insufficient_policy_depth');
  if (!policies.some((policy) => policy.severity === 'high')) issues.push('missing_high_severity_policy');
  if (!policies.every((policy) => policy.controls.length >= 1)) issues.push('missing_controls');
  return { ok: issues.length === 0, issues, policyCount: policies.length };
}

export function policySummaryTemplateVariants(policies = createTemplateVariantsPolicies()) {
  return { total: policies.length, watch: policies.filter((policy) => policy.status === 'watch').length, active: policies.filter((policy) => policy.status === 'active').length };
}

