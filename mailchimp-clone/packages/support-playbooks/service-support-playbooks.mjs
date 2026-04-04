import { createSupportPlaybooksWorkspace, summarizeSupportPlaybooks, createSupportPlaybooksNarratives } from './domain-support-playbooks.mjs';
import { createSupportPlaybooksPolicies, validateSupportPlaybooksPolicies, policySummarySupportPlaybooks } from './domain-support-playbooks-policies.mjs';

export function buildSupportPlaybooksSnapshot(workspaceName = 'Expansion workspace') {
  const workspace = createSupportPlaybooksWorkspace(workspaceName);
  const policies = createSupportPlaybooksPolicies();
  return {
    workspace,
    summary: summarizeSupportPlaybooks(workspace),
    narratives: createSupportPlaybooksNarratives(workspace),
    policies,
    policySummary: policySummarySupportPlaybooks(policies),
    validation: validateSupportPlaybooksPolicies(policies)
  };
}

export function createSupportPlaybooksChecklist(snapshot = buildSupportPlaybooksSnapshot()) {
  return [
    { id: 'support-playbooks-check-1', label: 'Brief scope', ok: snapshot.summary.metricCount >= 3 },
    { id: 'support-playbooks-check-2', label: 'Policy depth', ok: snapshot.validation.ok },
    { id: 'support-playbooks-check-3', label: 'Narratives ready', ok: snapshot.narratives.length >= 4 }
  ];
}

export function createSupportPlaybooksApiDocument(snapshot = buildSupportPlaybooksSnapshot()) {
  return {
    id: 'support-playbooks-api',
    headline: snapshot.summary.name + ' API contract',
    endpoints: [
      { method: 'GET', path: '/api/support-playbooks/overview' },
      { method: 'POST', path: '/api/support-playbooks/validate' },
      { method: 'GET', path: '/api/support-playbooks/policies' }
    ],
    checklist: createSupportPlaybooksChecklist(snapshot)
  };
}
