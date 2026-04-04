import { createDataResidencyWorkspace, summarizeDataResidency, createDataResidencyNarratives } from './domain-data-residency.mjs';
import { createDataResidencyPolicies, validateDataResidencyPolicies, policySummaryDataResidency } from './domain-data-residency-policies.mjs';

export function buildDataResidencySnapshot(workspaceName = 'Expansion workspace') {
  const workspace = createDataResidencyWorkspace(workspaceName);
  const policies = createDataResidencyPolicies();
  return {
    workspace,
    summary: summarizeDataResidency(workspace),
    narratives: createDataResidencyNarratives(workspace),
    policies,
    policySummary: policySummaryDataResidency(policies),
    validation: validateDataResidencyPolicies(policies)
  };
}

export function createDataResidencyChecklist(snapshot = buildDataResidencySnapshot()) {
  return [
    { id: 'data-residency-check-1', label: 'Brief scope', ok: snapshot.summary.metricCount >= 3 },
    { id: 'data-residency-check-2', label: 'Policy depth', ok: snapshot.validation.ok },
    { id: 'data-residency-check-3', label: 'Narratives ready', ok: snapshot.narratives.length >= 4 }
  ];
}

export function createDataResidencyApiDocument(snapshot = buildDataResidencySnapshot()) {
  return {
    id: 'data-residency-api',
    headline: snapshot.summary.name + ' API contract',
    endpoints: [
      { method: 'GET', path: '/api/data-residency/overview' },
      { method: 'POST', path: '/api/data-residency/validate' },
      { method: 'GET', path: '/api/data-residency/policies' }
    ],
    checklist: createDataResidencyChecklist(snapshot)
  };
}
