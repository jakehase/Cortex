import { createAudienceSyncWorkspace, summarizeAudienceSync, createAudienceSyncNarratives } from './domain-audience-sync.mjs';
import { createAudienceSyncPolicies, validateAudienceSyncPolicies, policySummaryAudienceSync } from './domain-audience-sync-policies.mjs';

export function buildAudienceSyncSnapshot(workspaceName = 'Expansion workspace') {
  const workspace = createAudienceSyncWorkspace(workspaceName);
  const policies = createAudienceSyncPolicies();
  return {
    workspace,
    summary: summarizeAudienceSync(workspace),
    narratives: createAudienceSyncNarratives(workspace),
    policies,
    policySummary: policySummaryAudienceSync(policies),
    validation: validateAudienceSyncPolicies(policies)
  };
}

export function createAudienceSyncChecklist(snapshot = buildAudienceSyncSnapshot()) {
  return [
    { id: 'audience-sync-check-1', label: 'Brief scope', ok: snapshot.summary.metricCount >= 3 },
    { id: 'audience-sync-check-2', label: 'Policy depth', ok: snapshot.validation.ok },
    { id: 'audience-sync-check-3', label: 'Narratives ready', ok: snapshot.narratives.length >= 4 }
  ];
}

export function createAudienceSyncApiDocument(snapshot = buildAudienceSyncSnapshot()) {
  return {
    id: 'audience-sync-api',
    headline: snapshot.summary.name + ' API contract',
    endpoints: [
      { method: 'GET', path: '/api/audience-sync/overview' },
      { method: 'POST', path: '/api/audience-sync/validate' },
      { method: 'GET', path: '/api/audience-sync/policies' }
    ],
    checklist: createAudienceSyncChecklist(snapshot)
  };
}
