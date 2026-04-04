import { createRevenueAttributionWorkspace, summarizeRevenueAttribution, createRevenueAttributionNarratives } from './domain-revenue-attribution.mjs';
import { createRevenueAttributionPolicies, validateRevenueAttributionPolicies, policySummaryRevenueAttribution } from './domain-revenue-attribution-policies.mjs';

export function buildRevenueAttributionSnapshot(workspaceName = 'Wave 6 workspace') {
  const workspace = createRevenueAttributionWorkspace(workspaceName);
  const policies = createRevenueAttributionPolicies();
  return { workspace, summary: summarizeRevenueAttribution(workspace), narratives: createRevenueAttributionNarratives(workspace), policies, policySummary: policySummaryRevenueAttribution(policies), validation: validateRevenueAttributionPolicies(policies) };
}

export function createRevenueAttributionChecklist(snapshot = buildRevenueAttributionSnapshot()) {
  return [
    { id: "revenue-attribution-check-1", label: 'Scope visible', ok: snapshot.summary.metricCount >= 3 },
    { id: "revenue-attribution-check-2", label: 'Policy depth', ok: snapshot.validation.ok },
    { id: "revenue-attribution-check-3", label: 'Narratives available', ok: snapshot.narratives.length >= 4 }
  ];
}

export function createRevenueAttributionApiDocument(snapshot = buildRevenueAttributionSnapshot()) {
  return {
    id: "revenue-attribution-api",
    headline: snapshot.summary.name + ' API contract',
    endpoints: [
      { method: 'GET', path: '/api/revenue-attribution/overview' },
      { method: 'POST', path: '/api/revenue-attribution/validate' },
      { method: 'GET', path: '/api/revenue-attribution/policies' }
    ],
    checklist: createRevenueAttributionChecklist(snapshot)
  };
}

