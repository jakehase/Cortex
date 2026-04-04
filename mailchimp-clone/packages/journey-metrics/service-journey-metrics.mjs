import { createJourneyMetricsWorkspace, summarizeJourneyMetrics, createJourneyMetricsNarratives } from './domain-journey-metrics.mjs';
import { createJourneyMetricsPolicies, validateJourneyMetricsPolicies, policySummaryJourneyMetrics } from './domain-journey-metrics-policies.mjs';

export function buildJourneyMetricsSnapshot(workspaceName = 'Expansion workspace') {
  const workspace = createJourneyMetricsWorkspace(workspaceName);
  const policies = createJourneyMetricsPolicies();
  return {
    workspace,
    summary: summarizeJourneyMetrics(workspace),
    narratives: createJourneyMetricsNarratives(workspace),
    policies,
    policySummary: policySummaryJourneyMetrics(policies),
    validation: validateJourneyMetricsPolicies(policies)
  };
}

export function createJourneyMetricsChecklist(snapshot = buildJourneyMetricsSnapshot()) {
  return [
    { id: 'journey-metrics-check-1', label: 'Brief scope', ok: snapshot.summary.metricCount >= 3 },
    { id: 'journey-metrics-check-2', label: 'Policy depth', ok: snapshot.validation.ok },
    { id: 'journey-metrics-check-3', label: 'Narratives ready', ok: snapshot.narratives.length >= 4 }
  ];
}

export function createJourneyMetricsApiDocument(snapshot = buildJourneyMetricsSnapshot()) {
  return {
    id: 'journey-metrics-api',
    headline: snapshot.summary.name + ' API contract',
    endpoints: [
      { method: 'GET', path: '/api/journey-metrics/overview' },
      { method: 'POST', path: '/api/journey-metrics/validate' },
      { method: 'GET', path: '/api/journey-metrics/policies' }
    ],
    checklist: createJourneyMetricsChecklist(snapshot)
  };
}
