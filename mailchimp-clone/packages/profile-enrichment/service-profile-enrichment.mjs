import { createProfileEnrichmentWorkspace, summarizeProfileEnrichment, createProfileEnrichmentNarratives } from './domain-profile-enrichment.mjs';
import { createProfileEnrichmentPolicies, validateProfileEnrichmentPolicies, policySummaryProfileEnrichment } from './domain-profile-enrichment-policies.mjs';

export function buildProfileEnrichmentSnapshot(workspaceName = 'Wave 6 workspace') {
  const workspace = createProfileEnrichmentWorkspace(workspaceName);
  const policies = createProfileEnrichmentPolicies();
  return { workspace, summary: summarizeProfileEnrichment(workspace), narratives: createProfileEnrichmentNarratives(workspace), policies, policySummary: policySummaryProfileEnrichment(policies), validation: validateProfileEnrichmentPolicies(policies) };
}

export function createProfileEnrichmentChecklist(snapshot = buildProfileEnrichmentSnapshot()) {
  return [
    { id: "profile-enrichment-check-1", label: 'Scope visible', ok: snapshot.summary.metricCount >= 3 },
    { id: "profile-enrichment-check-2", label: 'Policy depth', ok: snapshot.validation.ok },
    { id: "profile-enrichment-check-3", label: 'Narratives available', ok: snapshot.narratives.length >= 4 }
  ];
}

export function createProfileEnrichmentApiDocument(snapshot = buildProfileEnrichmentSnapshot()) {
  return {
    id: "profile-enrichment-api",
    headline: snapshot.summary.name + ' API contract',
    endpoints: [
      { method: 'GET', path: '/api/profile-enrichment/overview' },
      { method: 'POST', path: '/api/profile-enrichment/validate' },
      { method: 'GET', path: '/api/profile-enrichment/policies' }
    ],
    checklist: createProfileEnrichmentChecklist(snapshot)
  };
}

