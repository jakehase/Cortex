import { createCreativeQaWorkspace, summarizeCreativeQa, createCreativeQaNarratives } from './domain-creative-qa.mjs';
import { createCreativeQaPolicies, validateCreativeQaPolicies, policySummaryCreativeQa } from './domain-creative-qa-policies.mjs';

export function buildCreativeQaSnapshot(workspaceName = 'Wave 6 workspace') {
  const workspace = createCreativeQaWorkspace(workspaceName);
  const policies = createCreativeQaPolicies();
  return { workspace, summary: summarizeCreativeQa(workspace), narratives: createCreativeQaNarratives(workspace), policies, policySummary: policySummaryCreativeQa(policies), validation: validateCreativeQaPolicies(policies) };
}

export function createCreativeQaChecklist(snapshot = buildCreativeQaSnapshot()) {
  return [
    { id: "creative-qa-check-1", label: 'Scope visible', ok: snapshot.summary.metricCount >= 3 },
    { id: "creative-qa-check-2", label: 'Policy depth', ok: snapshot.validation.ok },
    { id: "creative-qa-check-3", label: 'Narratives available', ok: snapshot.narratives.length >= 4 }
  ];
}

export function createCreativeQaApiDocument(snapshot = buildCreativeQaSnapshot()) {
  return {
    id: "creative-qa-api",
    headline: snapshot.summary.name + ' API contract',
    endpoints: [
      { method: 'GET', path: '/api/creative-qa/overview' },
      { method: 'POST', path: '/api/creative-qa/validate' },
      { method: 'GET', path: '/api/creative-qa/policies' }
    ],
    checklist: createCreativeQaChecklist(snapshot)
  };
}

