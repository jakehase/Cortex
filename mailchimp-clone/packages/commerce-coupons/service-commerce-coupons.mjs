import { createCommerceCouponsWorkspace, summarizeCommerceCoupons, createCommerceCouponsNarratives } from './domain-commerce-coupons.mjs';
import { createCommerceCouponsPolicies, validateCommerceCouponsPolicies, policySummaryCommerceCoupons } from './domain-commerce-coupons-policies.mjs';

export function buildCommerceCouponsSnapshot(workspaceName = 'Continuation workspace') {
  const workspace = createCommerceCouponsWorkspace(workspaceName);
  const policies = createCommerceCouponsPolicies();
  return { workspace, summary: summarizeCommerceCoupons(workspace), narratives: createCommerceCouponsNarratives(workspace), policies, policySummary: policySummaryCommerceCoupons(policies), validation: validateCommerceCouponsPolicies(policies) };
}

export function createCommerceCouponsChecklist(snapshot = buildCommerceCouponsSnapshot()) {
  return [
    { id: 'commerce-coupons-check-1', label: 'Scope visible', ok: snapshot.summary.metricCount >= 3 },
    { id: 'commerce-coupons-check-2', label: 'Policy depth', ok: snapshot.validation.ok },
    { id: 'commerce-coupons-check-3', label: 'Narratives available', ok: snapshot.narratives.length >= 4 }
  ];
}

export function createCommerceCouponsApiDocument(snapshot = buildCommerceCouponsSnapshot()) {
  return { id: 'commerce-coupons-api', headline: snapshot.summary.name + ' API contract', endpoints: [{ method: 'GET', path: '/api/commerce-coupons/overview' }, { method: 'POST', path: '/api/commerce-coupons/validate' }, { method: 'GET', path: '/api/commerce-coupons/policies' }], checklist: createCommerceCouponsChecklist(snapshot) };
}
