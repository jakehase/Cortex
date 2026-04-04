import { createCustomerHealthWorkspace, summarizeCustomerHealth, createCustomerHealthNarratives } from './domain-customer-health.mjs';
import { createCustomerHealthPolicies, validateCustomerHealthPolicies, policySummaryCustomerHealth } from './domain-customer-health-policies.mjs';

export function buildCustomerHealthSnapshot(workspaceName = 'Wave 6 workspace') {
  const workspace = createCustomerHealthWorkspace(workspaceName);
  const policies = createCustomerHealthPolicies();
  return { workspace, summary: summarizeCustomerHealth(workspace), narratives: createCustomerHealthNarratives(workspace), policies, policySummary: policySummaryCustomerHealth(policies), validation: validateCustomerHealthPolicies(policies) };
}

export function createCustomerHealthChecklist(snapshot = buildCustomerHealthSnapshot()) {
  return [
    { id: "customer-health-check-1", label: 'Scope visible', ok: snapshot.summary.metricCount >= 3 },
    { id: "customer-health-check-2", label: 'Policy depth', ok: snapshot.validation.ok },
    { id: "customer-health-check-3", label: 'Narratives available', ok: snapshot.narratives.length >= 4 }
  ];
}

export function createCustomerHealthApiDocument(snapshot = buildCustomerHealthSnapshot()) {
  return {
    id: "customer-health-api",
    headline: snapshot.summary.name + ' API contract',
    endpoints: [
      { method: 'GET', path: '/api/customer-health/overview' },
      { method: 'POST', path: '/api/customer-health/validate' },
      { method: 'GET', path: '/api/customer-health/policies' }
    ],
    checklist: createCustomerHealthChecklist(snapshot)
  };
}

