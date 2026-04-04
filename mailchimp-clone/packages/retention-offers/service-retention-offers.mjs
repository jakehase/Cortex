import { createRetentionOffersWorkspace, summarizeRetentionOffers, createRetentionOffersNarratives } from './domain-retention-offers.mjs';
import { createRetentionOffersPolicies, validateRetentionOffersPolicies, policySummaryRetentionOffers } from './domain-retention-offers-policies.mjs';

export function buildRetentionOffersSnapshot(workspaceName = 'Wave 6 workspace') {
  const workspace = createRetentionOffersWorkspace(workspaceName);
  const policies = createRetentionOffersPolicies();
  return { workspace, summary: summarizeRetentionOffers(workspace), narratives: createRetentionOffersNarratives(workspace), policies, policySummary: policySummaryRetentionOffers(policies), validation: validateRetentionOffersPolicies(policies) };
}

export function createRetentionOffersChecklist(snapshot = buildRetentionOffersSnapshot()) {
  return [
    { id: "retention-offers-check-1", label: 'Scope visible', ok: snapshot.summary.metricCount >= 3 },
    { id: "retention-offers-check-2", label: 'Policy depth', ok: snapshot.validation.ok },
    { id: "retention-offers-check-3", label: 'Narratives available', ok: snapshot.narratives.length >= 4 }
  ];
}

export function createRetentionOffersApiDocument(snapshot = buildRetentionOffersSnapshot()) {
  return {
    id: "retention-offers-api",
    headline: snapshot.summary.name + ' API contract',
    endpoints: [
      { method: 'GET', path: '/api/retention-offers/overview' },
      { method: 'POST', path: '/api/retention-offers/validate' },
      { method: 'GET', path: '/api/retention-offers/policies' }
    ],
    checklist: createRetentionOffersChecklist(snapshot)
  };
}

