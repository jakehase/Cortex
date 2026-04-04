import { createAttributionModelingWorkspace, summarizeAttributionModeling, createAttributionModelingNarratives } from './domain-attribution-modeling.mjs';
import { createAttributionModelingPolicies, validateAttributionModelingPolicies, policySummaryAttributionModeling } from './domain-attribution-modeling-policies.mjs';

export function buildAttributionModelingSnapshot(workspaceName = 'Wave 6 workspace') {
  const workspace = createAttributionModelingWorkspace(workspaceName);
  const policies = createAttributionModelingPolicies();
  return { workspace, summary: summarizeAttributionModeling(workspace), narratives: createAttributionModelingNarratives(workspace), policies, policySummary: policySummaryAttributionModeling(policies), validation: validateAttributionModelingPolicies(policies) };
}

export function createAttributionModelingChecklist(snapshot = buildAttributionModelingSnapshot()) {
  return [
    { id: "attribution-modeling-check-1", label: 'Scope visible', ok: snapshot.summary.metricCount >= 3 },
    { id: "attribution-modeling-check-2", label: 'Policy depth', ok: snapshot.validation.ok },
    { id: "attribution-modeling-check-3", label: 'Narratives available', ok: snapshot.narratives.length >= 4 }
  ];
}

export function createAttributionModelingApiDocument(snapshot = buildAttributionModelingSnapshot()) {
  return {
    id: "attribution-modeling-api",
    headline: snapshot.summary.name + ' API contract',
    endpoints: [
      { method: 'GET', path: '/api/attribution-modeling/overview' },
      { method: 'POST', path: '/api/attribution-modeling/validate' },
      { method: 'GET', path: '/api/attribution-modeling/policies' }
    ],
    checklist: createAttributionModelingChecklist(snapshot)
  };
}

