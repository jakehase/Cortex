import { createRetentionLabWorkspace, summarizeRetentionLab, createRetentionLabNarratives } from './domain-retention-lab.mjs';
import { createRetentionLabPolicies, validateRetentionLabPolicies, policySummaryRetentionLab } from './domain-retention-lab-policies.mjs';

export function buildRetentionLabSnapshot(workspaceName = 'Expansion workspace') {
  const workspace = createRetentionLabWorkspace(workspaceName);
  const policies = createRetentionLabPolicies();
  return {
    workspace,
    summary: summarizeRetentionLab(workspace),
    narratives: createRetentionLabNarratives(workspace),
    policies,
    policySummary: policySummaryRetentionLab(policies),
    validation: validateRetentionLabPolicies(policies)
  };
}

export function createRetentionLabChecklist(snapshot = buildRetentionLabSnapshot()) {
  return [
    { id: 'retention-lab-check-1', label: 'Brief scope', ok: snapshot.summary.metricCount >= 3 },
    { id: 'retention-lab-check-2', label: 'Policy depth', ok: snapshot.validation.ok },
    { id: 'retention-lab-check-3', label: 'Narratives ready', ok: snapshot.narratives.length >= 4 }
  ];
}

export function createRetentionLabApiDocument(snapshot = buildRetentionLabSnapshot()) {
  return {
    id: 'retention-lab-api',
    headline: snapshot.summary.name + ' API contract',
    endpoints: [
      { method: 'GET', path: '/api/retention-lab/overview' },
      { method: 'POST', path: '/api/retention-lab/validate' },
      { method: 'GET', path: '/api/retention-lab/policies' }
    ],
    checklist: createRetentionLabChecklist(snapshot)
  };
}
