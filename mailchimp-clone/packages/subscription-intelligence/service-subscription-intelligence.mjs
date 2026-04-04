import { createSubscriptionIntelligenceWorkspace, summarizeSubscriptionIntelligence, createSubscriptionIntelligenceNarratives } from './domain-subscription-intelligence.mjs';
import { createSubscriptionIntelligencePolicies, validateSubscriptionIntelligencePolicies, policySummarySubscriptionIntelligence } from './domain-subscription-intelligence-policies.mjs';

export function buildSubscriptionIntelligenceSnapshot(workspaceName = 'Wave 6 workspace') {
  const workspace = createSubscriptionIntelligenceWorkspace(workspaceName);
  const policies = createSubscriptionIntelligencePolicies();
  return { workspace, summary: summarizeSubscriptionIntelligence(workspace), narratives: createSubscriptionIntelligenceNarratives(workspace), policies, policySummary: policySummarySubscriptionIntelligence(policies), validation: validateSubscriptionIntelligencePolicies(policies) };
}

export function createSubscriptionIntelligenceChecklist(snapshot = buildSubscriptionIntelligenceSnapshot()) {
  return [
    { id: "subscription-intelligence-check-1", label: 'Scope visible', ok: snapshot.summary.metricCount >= 3 },
    { id: "subscription-intelligence-check-2", label: 'Policy depth', ok: snapshot.validation.ok },
    { id: "subscription-intelligence-check-3", label: 'Narratives available', ok: snapshot.narratives.length >= 4 }
  ];
}

export function createSubscriptionIntelligenceApiDocument(snapshot = buildSubscriptionIntelligenceSnapshot()) {
  return {
    id: "subscription-intelligence-api",
    headline: snapshot.summary.name + ' API contract',
    endpoints: [
      { method: 'GET', path: '/api/subscription-intelligence/overview' },
      { method: 'POST', path: '/api/subscription-intelligence/validate' },
      { method: 'GET', path: '/api/subscription-intelligence/policies' }
    ],
    checklist: createSubscriptionIntelligenceChecklist(snapshot)
  };
}

