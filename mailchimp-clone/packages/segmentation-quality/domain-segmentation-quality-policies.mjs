const DEFAULT_POLICIES = [
  { id: "segmentation-quality-policy-1", title: "Segmentation Quality guardrail", severity: 'medium' },
  { id: "segmentation-quality-policy-2", title: "Segmentation Quality approval ring", severity: 'high' },
  { id: "segmentation-quality-policy-3", title: "Segmentation Quality rollback lane", severity: 'medium' }
];

export function createSegmentationQualityPolicies(overrides = {}) {
  return DEFAULT_POLICIES.map((policy, index) => ({
    ...policy,
    owner: overrides.owner || 'wave6-owner',
    status: overrides.status || (index === 1 ? 'watch' : 'active'),
    controls: ['change-log', 'approval-ring', 'rollback-check'].slice(0, index + 1),
    notes: overrides.notes || "Segmentation Quality policy pack for the real-repo expansion wave."
  }));
}

export function validateSegmentationQualityPolicies(policies = createSegmentationQualityPolicies()) {
  const issues = [];
  if (policies.length < 3) issues.push('insufficient_policy_depth');
  if (!policies.some((policy) => policy.severity === 'high')) issues.push('missing_high_severity_policy');
  if (!policies.every((policy) => policy.controls.length >= 1)) issues.push('missing_controls');
  return { ok: issues.length === 0, issues, policyCount: policies.length };
}

export function policySummarySegmentationQuality(policies = createSegmentationQualityPolicies()) {
  return { total: policies.length, watch: policies.filter((policy) => policy.status === 'watch').length, active: policies.filter((policy) => policy.status === 'active').length };
}

