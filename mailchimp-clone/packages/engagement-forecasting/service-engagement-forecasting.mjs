import { createEngagementForecastingWorkspace, summarizeEngagementForecasting, createEngagementForecastingNarratives } from './domain-engagement-forecasting.mjs';
import { createEngagementForecastingPolicies, validateEngagementForecastingPolicies, policySummaryEngagementForecasting } from './domain-engagement-forecasting-policies.mjs';

export function buildEngagementForecastingSnapshot(workspaceName = 'Wave 6 workspace') {
  const workspace = createEngagementForecastingWorkspace(workspaceName);
  const policies = createEngagementForecastingPolicies();
  return { workspace, summary: summarizeEngagementForecasting(workspace), narratives: createEngagementForecastingNarratives(workspace), policies, policySummary: policySummaryEngagementForecasting(policies), validation: validateEngagementForecastingPolicies(policies) };
}

export function createEngagementForecastingChecklist(snapshot = buildEngagementForecastingSnapshot()) {
  return [
    { id: "engagement-forecasting-check-1", label: 'Scope visible', ok: snapshot.summary.metricCount >= 3 },
    { id: "engagement-forecasting-check-2", label: 'Policy depth', ok: snapshot.validation.ok },
    { id: "engagement-forecasting-check-3", label: 'Narratives available', ok: snapshot.narratives.length >= 4 }
  ];
}

export function createEngagementForecastingApiDocument(snapshot = buildEngagementForecastingSnapshot()) {
  return {
    id: "engagement-forecasting-api",
    headline: snapshot.summary.name + ' API contract',
    endpoints: [
      { method: 'GET', path: '/api/engagement-forecasting/overview' },
      { method: 'POST', path: '/api/engagement-forecasting/validate' },
      { method: 'GET', path: '/api/engagement-forecasting/policies' }
    ],
    checklist: createEngagementForecastingChecklist(snapshot)
  };
}

