import { createCustomerLifecycleWorkspace, summarizeCustomerLifecycle, createCustomerLifecycleNarratives } from './domain-customer-lifecycle.mjs';
import { createCustomerLifecyclePolicies, validateCustomerLifecyclePolicies, policySummaryCustomerLifecycle } from './domain-customer-lifecycle-policies.mjs';

export function buildCustomerLifecycleSnapshot(workspaceName = 'Expansion workspace') {
  const workspace = createCustomerLifecycleWorkspace(workspaceName);
  const policies = createCustomerLifecyclePolicies();
  return {
    workspace,
    summary: summarizeCustomerLifecycle(workspace),
    narratives: createCustomerLifecycleNarratives(workspace),
    policies,
    policySummary: policySummaryCustomerLifecycle(policies),
    validation: validateCustomerLifecyclePolicies(policies)
  };
}

export function createCustomerLifecycleChecklist(snapshot = buildCustomerLifecycleSnapshot()) {
  return [
    { id: 'customer-lifecycle-check-1', label: 'Brief scope', ok: snapshot.summary.metricCount >= 3 },
    { id: 'customer-lifecycle-check-2', label: 'Policy depth', ok: snapshot.validation.ok },
    { id: 'customer-lifecycle-check-3', label: 'Narratives ready', ok: snapshot.narratives.length >= 4 }
  ];
}

export function createCustomerLifecycleApiDocument(snapshot = buildCustomerLifecycleSnapshot()) {
  return {
    id: 'customer-lifecycle-api',
    headline: snapshot.summary.name + ' API contract',
    endpoints: [
      { method: 'GET', path: '/api/customer-lifecycle/overview' },
      { method: 'POST', path: '/api/customer-lifecycle/validate' },
      { method: 'GET', path: '/api/customer-lifecycle/policies' }
    ],
    checklist: createCustomerLifecycleChecklist(snapshot)
  };
}
