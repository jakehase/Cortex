import { createPartnerSuccessWorkspace, summarizePartnerSuccess, createPartnerSuccessNarratives } from './domain-partner-success.mjs';
import { createPartnerSuccessPolicies, validatePartnerSuccessPolicies, policySummaryPartnerSuccess } from './domain-partner-success-policies.mjs';

export function buildPartnerSuccessSnapshot(workspaceName = 'Expansion workspace') {
  const workspace = createPartnerSuccessWorkspace(workspaceName);
  const policies = createPartnerSuccessPolicies();
  return {
    workspace,
    summary: summarizePartnerSuccess(workspace),
    narratives: createPartnerSuccessNarratives(workspace),
    policies,
    policySummary: policySummaryPartnerSuccess(policies),
    validation: validatePartnerSuccessPolicies(policies)
  };
}

export function createPartnerSuccessChecklist(snapshot = buildPartnerSuccessSnapshot()) {
  return [
    { id: 'partner-success-check-1', label: 'Brief scope', ok: snapshot.summary.metricCount >= 3 },
    { id: 'partner-success-check-2', label: 'Policy depth', ok: snapshot.validation.ok },
    { id: 'partner-success-check-3', label: 'Narratives ready', ok: snapshot.narratives.length >= 4 }
  ];
}

export function createPartnerSuccessApiDocument(snapshot = buildPartnerSuccessSnapshot()) {
  return {
    id: 'partner-success-api',
    headline: snapshot.summary.name + ' API contract',
    endpoints: [
      { method: 'GET', path: '/api/partner-success/overview' },
      { method: 'POST', path: '/api/partner-success/validate' },
      { method: 'GET', path: '/api/partner-success/policies' }
    ],
    checklist: createPartnerSuccessChecklist(snapshot)
  };
}
