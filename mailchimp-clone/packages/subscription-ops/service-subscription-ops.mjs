import { createSubscriptionOpsWorkspace, summarizeSubscriptionOps, createSubscriptionOpsNarratives } from './domain-subscription-ops.mjs';
import { createSubscriptionOpsPolicies, validateSubscriptionOpsPolicies, policySummarySubscriptionOps } from './domain-subscription-ops-policies.mjs';

export function buildSubscriptionOpsSnapshot(workspaceName = 'Expansion workspace') {
  const workspace = createSubscriptionOpsWorkspace(workspaceName);
  const policies = createSubscriptionOpsPolicies();
  return {
    workspace,
    summary: summarizeSubscriptionOps(workspace),
    narratives: createSubscriptionOpsNarratives(workspace),
    policies,
    policySummary: policySummarySubscriptionOps(policies),
    validation: validateSubscriptionOpsPolicies(policies)
  };
}

export function createSubscriptionOpsChecklist(snapshot = buildSubscriptionOpsSnapshot()) {
  return [
    { id: 'subscription-ops-check-1', label: 'Brief scope', ok: snapshot.summary.metricCount >= 3 },
    { id: 'subscription-ops-check-2', label: 'Policy depth', ok: snapshot.validation.ok },
    { id: 'subscription-ops-check-3', label: 'Narratives ready', ok: snapshot.narratives.length >= 4 }
  ];
}

export function createSubscriptionOpsApiDocument(snapshot = buildSubscriptionOpsSnapshot()) {
  return {
    id: 'subscription-ops-api',
    headline: snapshot.summary.name + ' API contract',
    endpoints: [
      { method: 'GET', path: '/api/subscription-ops/overview' },
      { method: 'POST', path: '/api/subscription-ops/validate' },
      { method: 'GET', path: '/api/subscription-ops/policies' }
    ],
    checklist: createSubscriptionOpsChecklist(snapshot)
  };
}
