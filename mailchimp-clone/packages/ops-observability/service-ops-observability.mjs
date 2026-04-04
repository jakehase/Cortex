import { createOpsObservabilityWorkspace, summarizeOpsObservability, createOpsObservabilityNarratives } from './domain-ops-observability.mjs';
import { createOpsObservabilityPolicies, validateOpsObservabilityPolicies, policySummaryOpsObservability } from './domain-ops-observability-policies.mjs';

export function buildOpsObservabilitySnapshot(workspaceName = 'Expansion workspace') {
  const workspace = createOpsObservabilityWorkspace(workspaceName);
  const policies = createOpsObservabilityPolicies();
  return {
    workspace,
    summary: summarizeOpsObservability(workspace),
    narratives: createOpsObservabilityNarratives(workspace),
    policies,
    policySummary: policySummaryOpsObservability(policies),
    validation: validateOpsObservabilityPolicies(policies)
  };
}

export function createOpsObservabilityChecklist(snapshot = buildOpsObservabilitySnapshot()) {
  return [
    { id: 'ops-observability-check-1', label: 'Brief scope', ok: snapshot.summary.metricCount >= 3 },
    { id: 'ops-observability-check-2', label: 'Policy depth', ok: snapshot.validation.ok },
    { id: 'ops-observability-check-3', label: 'Narratives ready', ok: snapshot.narratives.length >= 4 }
  ];
}

export function createOpsObservabilityApiDocument(snapshot = buildOpsObservabilitySnapshot()) {
  return {
    id: 'ops-observability-api',
    headline: snapshot.summary.name + ' API contract',
    endpoints: [
      { method: 'GET', path: '/api/ops-observability/overview' },
      { method: 'POST', path: '/api/ops-observability/validate' },
      { method: 'GET', path: '/api/ops-observability/policies' }
    ],
    checklist: createOpsObservabilityChecklist(snapshot)
  };
}
