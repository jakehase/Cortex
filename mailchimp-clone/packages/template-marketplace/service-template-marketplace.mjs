import { createTemplateMarketplaceWorkspace, summarizeTemplateMarketplace, createTemplateMarketplaceNarratives } from './domain-template-marketplace.mjs';
import { createTemplateMarketplacePolicies, validateTemplateMarketplacePolicies, policySummaryTemplateMarketplace } from './domain-template-marketplace-policies.mjs';

export function buildTemplateMarketplaceSnapshot(workspaceName = 'Expansion workspace') {
  const workspace = createTemplateMarketplaceWorkspace(workspaceName);
  const policies = createTemplateMarketplacePolicies();
  return {
    workspace,
    summary: summarizeTemplateMarketplace(workspace),
    narratives: createTemplateMarketplaceNarratives(workspace),
    policies,
    policySummary: policySummaryTemplateMarketplace(policies),
    validation: validateTemplateMarketplacePolicies(policies)
  };
}

export function createTemplateMarketplaceChecklist(snapshot = buildTemplateMarketplaceSnapshot()) {
  return [
    { id: 'template-marketplace-check-1', label: 'Brief scope', ok: snapshot.summary.metricCount >= 3 },
    { id: 'template-marketplace-check-2', label: 'Policy depth', ok: snapshot.validation.ok },
    { id: 'template-marketplace-check-3', label: 'Narratives ready', ok: snapshot.narratives.length >= 4 }
  ];
}

export function createTemplateMarketplaceApiDocument(snapshot = buildTemplateMarketplaceSnapshot()) {
  return {
    id: 'template-marketplace-api',
    headline: snapshot.summary.name + ' API contract',
    endpoints: [
      { method: 'GET', path: '/api/template-marketplace/overview' },
      { method: 'POST', path: '/api/template-marketplace/validate' },
      { method: 'GET', path: '/api/template-marketplace/policies' }
    ],
    checklist: createTemplateMarketplaceChecklist(snapshot)
  };
}
