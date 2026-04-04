import { createDataActivationWorkspace, summarizeDataActivation, createDataActivationNarratives } from './domain-data-activation.mjs';
import { createDataActivationPolicies, validateDataActivationPolicies, policySummaryDataActivation } from './domain-data-activation-policies.mjs';

export function buildDataActivationSnapshot(workspaceName = 'Wave 6 workspace') {
  const workspace = createDataActivationWorkspace(workspaceName);
  const policies = createDataActivationPolicies();
  return { workspace, summary: summarizeDataActivation(workspace), narratives: createDataActivationNarratives(workspace), policies, policySummary: policySummaryDataActivation(policies), validation: validateDataActivationPolicies(policies) };
}

export function createDataActivationChecklist(snapshot = buildDataActivationSnapshot()) {
  return [
    { id: "data-activation-check-1", label: 'Scope visible', ok: snapshot.summary.metricCount >= 3 },
    { id: "data-activation-check-2", label: 'Policy depth', ok: snapshot.validation.ok },
    { id: "data-activation-check-3", label: 'Narratives available', ok: snapshot.narratives.length >= 4 }
  ];
}

export function createDataActivationApiDocument(snapshot = buildDataActivationSnapshot()) {
  return {
    id: "data-activation-api",
    headline: snapshot.summary.name + ' API contract',
    endpoints: [
      { method: 'GET', path: '/api/data-activation/overview' },
      { method: 'POST', path: '/api/data-activation/validate' },
      { method: 'GET', path: '/api/data-activation/policies' }
    ],
    checklist: createDataActivationChecklist(snapshot)
  };
}

