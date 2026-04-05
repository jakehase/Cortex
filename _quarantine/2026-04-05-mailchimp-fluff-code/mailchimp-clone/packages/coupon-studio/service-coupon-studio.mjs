import { createCouponStudioWorkspace, summarizeCouponStudio, createCouponStudioNarratives } from './domain-coupon-studio.mjs';
import { createCouponStudioPolicies, validateCouponStudioPolicies, policySummaryCouponStudio } from './domain-coupon-studio-policies.mjs';

export function buildCouponStudioSnapshot(workspaceName = 'Expansion workspace') {
  const workspace = createCouponStudioWorkspace(workspaceName);
  const policies = createCouponStudioPolicies();
  return {
    workspace,
    summary: summarizeCouponStudio(workspace),
    narratives: createCouponStudioNarratives(workspace),
    policies,
    policySummary: policySummaryCouponStudio(policies),
    validation: validateCouponStudioPolicies(policies)
  };
}

export function createCouponStudioChecklist(snapshot = buildCouponStudioSnapshot()) {
  return [
    { id: 'coupon-studio-check-1', label: 'Brief scope', ok: snapshot.summary.metricCount >= 3 },
    { id: 'coupon-studio-check-2', label: 'Policy depth', ok: snapshot.validation.ok },
    { id: 'coupon-studio-check-3', label: 'Narratives ready', ok: snapshot.narratives.length >= 4 }
  ];
}

export function createCouponStudioApiDocument(snapshot = buildCouponStudioSnapshot()) {
  return {
    id: 'coupon-studio-api',
    headline: snapshot.summary.name + ' API contract',
    endpoints: [
      { method: 'GET', path: '/api/coupon-studio/overview' },
      { method: 'POST', path: '/api/coupon-studio/validate' },
      { method: 'GET', path: '/api/coupon-studio/policies' }
    ],
    checklist: createCouponStudioChecklist(snapshot)
  };
}
