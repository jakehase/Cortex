import { createMultiAccountControlWorkspace, summarizeMultiAccountControl, createMultiAccountControlNarratives } from './domain-multi-account-control.mjs';
import { createMultiAccountControlPolicies, validateMultiAccountControlPolicies, policySummaryMultiAccountControl } from './domain-multi-account-control-policies.mjs';

export function buildMultiAccountControlSnapshot(workspaceName = 'Wave 6 workspace') {
  const workspace = createMultiAccountControlWorkspace(workspaceName);
  const policies = createMultiAccountControlPolicies();
  return { workspace, summary: summarizeMultiAccountControl(workspace), narratives: createMultiAccountControlNarratives(workspace), policies, policySummary: policySummaryMultiAccountControl(policies), validation: validateMultiAccountControlPolicies(policies) };
}

export function createMultiAccountControlChecklist(snapshot = buildMultiAccountControlSnapshot()) {
  return [
    { id: "multi-account-control-check-1", label: 'Scope visible', ok: snapshot.summary.metricCount >= 3 },
    { id: "multi-account-control-check-2", label: 'Policy depth', ok: snapshot.validation.ok },
    { id: "multi-account-control-check-3", label: 'Narratives available', ok: snapshot.narratives.length >= 4 }
  ];
}

export function createMultiAccountControlApiDocument(snapshot = buildMultiAccountControlSnapshot()) {
  return {
    id: "multi-account-control-api",
    headline: snapshot.summary.name + ' API contract',
    endpoints: [
      { method: 'GET', path: '/api/multi-account-control/overview' },
      { method: 'POST', path: '/api/multi-account-control/validate' },
      { method: 'GET', path: '/api/multi-account-control/policies' }
    ],
    checklist: createMultiAccountControlChecklist(snapshot)
  };
}

