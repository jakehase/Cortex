import { createBillingAnalyticsWorkspace, summarizeBillingAnalytics, createBillingAnalyticsNarratives } from './domain-billing-analytics.mjs';
import { createBillingAnalyticsPolicies, validateBillingAnalyticsPolicies, policySummaryBillingAnalytics } from './domain-billing-analytics-policies.mjs';

export function buildBillingAnalyticsSnapshot(workspaceName = 'Expansion workspace') {
  const workspace = createBillingAnalyticsWorkspace(workspaceName);
  const policies = createBillingAnalyticsPolicies();
  return {
    workspace,
    summary: summarizeBillingAnalytics(workspace),
    narratives: createBillingAnalyticsNarratives(workspace),
    policies,
    policySummary: policySummaryBillingAnalytics(policies),
    validation: validateBillingAnalyticsPolicies(policies)
  };
}

export function createBillingAnalyticsChecklist(snapshot = buildBillingAnalyticsSnapshot()) {
  return [
    { id: 'billing-analytics-check-1', label: 'Brief scope', ok: snapshot.summary.metricCount >= 3 },
    { id: 'billing-analytics-check-2', label: 'Policy depth', ok: snapshot.validation.ok },
    { id: 'billing-analytics-check-3', label: 'Narratives ready', ok: snapshot.narratives.length >= 4 }
  ];
}

export function createBillingAnalyticsApiDocument(snapshot = buildBillingAnalyticsSnapshot()) {
  return {
    id: 'billing-analytics-api',
    headline: snapshot.summary.name + ' API contract',
    endpoints: [
      { method: 'GET', path: '/api/billing-analytics/overview' },
      { method: 'POST', path: '/api/billing-analytics/validate' },
      { method: 'GET', path: '/api/billing-analytics/policies' }
    ],
    checklist: createBillingAnalyticsChecklist(snapshot)
  };
}
