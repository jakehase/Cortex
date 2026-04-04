import { createMultiBrandHqWorkspace, summarizeMultiBrandHq, createMultiBrandHqNarratives } from './domain-multi-brand-hq.mjs';
import { createMultiBrandHqPolicies, validateMultiBrandHqPolicies, policySummaryMultiBrandHq } from './domain-multi-brand-hq-policies.mjs';

export function buildMultiBrandHqSnapshot(workspaceName = 'Expansion workspace') {
  const workspace = createMultiBrandHqWorkspace(workspaceName);
  const policies = createMultiBrandHqPolicies();
  return {
    workspace,
    summary: summarizeMultiBrandHq(workspace),
    narratives: createMultiBrandHqNarratives(workspace),
    policies,
    policySummary: policySummaryMultiBrandHq(policies),
    validation: validateMultiBrandHqPolicies(policies)
  };
}

export function createMultiBrandHqChecklist(snapshot = buildMultiBrandHqSnapshot()) {
  return [
    { id: 'multi-brand-hq-check-1', label: 'Brief scope', ok: snapshot.summary.metricCount >= 3 },
    { id: 'multi-brand-hq-check-2', label: 'Policy depth', ok: snapshot.validation.ok },
    { id: 'multi-brand-hq-check-3', label: 'Narratives ready', ok: snapshot.narratives.length >= 4 }
  ];
}

export function createMultiBrandHqApiDocument(snapshot = buildMultiBrandHqSnapshot()) {
  return {
    id: 'multi-brand-hq-api',
    headline: snapshot.summary.name + ' API contract',
    endpoints: [
      { method: 'GET', path: '/api/multi-brand-hq/overview' },
      { method: 'POST', path: '/api/multi-brand-hq/validate' },
      { method: 'GET', path: '/api/multi-brand-hq/policies' }
    ],
    checklist: createMultiBrandHqChecklist(snapshot)
  };
}
