import { createWorkspaceCatalogWorkspace, summarizeWorkspaceCatalog, createWorkspaceCatalogNarratives } from './domain-workspace-catalog.mjs';
import { createWorkspaceCatalogPolicies, validateWorkspaceCatalogPolicies, policySummaryWorkspaceCatalog } from './domain-workspace-catalog-policies.mjs';

export function buildWorkspaceCatalogSnapshot(workspaceName = 'Expansion workspace') {
  const workspace = createWorkspaceCatalogWorkspace(workspaceName);
  const policies = createWorkspaceCatalogPolicies();
  return {
    workspace,
    summary: summarizeWorkspaceCatalog(workspace),
    narratives: createWorkspaceCatalogNarratives(workspace),
    policies,
    policySummary: policySummaryWorkspaceCatalog(policies),
    validation: validateWorkspaceCatalogPolicies(policies)
  };
}

export function createWorkspaceCatalogChecklist(snapshot = buildWorkspaceCatalogSnapshot()) {
  return [
    { id: 'workspace-catalog-check-1', label: 'Brief scope', ok: snapshot.summary.metricCount >= 3 },
    { id: 'workspace-catalog-check-2', label: 'Policy depth', ok: snapshot.validation.ok },
    { id: 'workspace-catalog-check-3', label: 'Narratives ready', ok: snapshot.narratives.length >= 4 }
  ];
}

export function createWorkspaceCatalogApiDocument(snapshot = buildWorkspaceCatalogSnapshot()) {
  return {
    id: 'workspace-catalog-api',
    headline: snapshot.summary.name + ' API contract',
    endpoints: [
      { method: 'GET', path: '/api/workspace-catalog/overview' },
      { method: 'POST', path: '/api/workspace-catalog/validate' },
      { method: 'GET', path: '/api/workspace-catalog/policies' }
    ],
    checklist: createWorkspaceCatalogChecklist(snapshot)
  };
}
