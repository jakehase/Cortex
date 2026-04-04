import { createEcommerceInsightsWorkspace, summarizeEcommerceInsights, createEcommerceInsightsNarratives } from './domain-ecommerce-insights.mjs';
import { createEcommerceInsightsPolicies, validateEcommerceInsightsPolicies, policySummaryEcommerceInsights } from './domain-ecommerce-insights-policies.mjs';

export function buildEcommerceInsightsSnapshot(workspaceName = 'Wave 6 workspace') {
  const workspace = createEcommerceInsightsWorkspace(workspaceName);
  const policies = createEcommerceInsightsPolicies();
  return { workspace, summary: summarizeEcommerceInsights(workspace), narratives: createEcommerceInsightsNarratives(workspace), policies, policySummary: policySummaryEcommerceInsights(policies), validation: validateEcommerceInsightsPolicies(policies) };
}

export function createEcommerceInsightsChecklist(snapshot = buildEcommerceInsightsSnapshot()) {
  return [
    { id: "ecommerce-insights-check-1", label: 'Scope visible', ok: snapshot.summary.metricCount >= 3 },
    { id: "ecommerce-insights-check-2", label: 'Policy depth', ok: snapshot.validation.ok },
    { id: "ecommerce-insights-check-3", label: 'Narratives available', ok: snapshot.narratives.length >= 4 }
  ];
}

export function createEcommerceInsightsApiDocument(snapshot = buildEcommerceInsightsSnapshot()) {
  return {
    id: "ecommerce-insights-api",
    headline: snapshot.summary.name + ' API contract',
    endpoints: [
      { method: 'GET', path: '/api/ecommerce-insights/overview' },
      { method: 'POST', path: '/api/ecommerce-insights/validate' },
      { method: 'GET', path: '/api/ecommerce-insights/policies' }
    ],
    checklist: createEcommerceInsightsChecklist(snapshot)
  };
}

