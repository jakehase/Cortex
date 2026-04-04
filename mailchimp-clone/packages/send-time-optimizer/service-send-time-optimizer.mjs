import { createSendTimeOptimizerWorkspace, summarizeSendTimeOptimizer, createSendTimeOptimizerNarratives } from './domain-send-time-optimizer.mjs';
import { createSendTimeOptimizerPolicies, validateSendTimeOptimizerPolicies, policySummarySendTimeOptimizer } from './domain-send-time-optimizer-policies.mjs';

export function buildSendTimeOptimizerSnapshot(workspaceName = 'Expansion workspace') {
  const workspace = createSendTimeOptimizerWorkspace(workspaceName);
  const policies = createSendTimeOptimizerPolicies();
  return {
    workspace,
    summary: summarizeSendTimeOptimizer(workspace),
    narratives: createSendTimeOptimizerNarratives(workspace),
    policies,
    policySummary: policySummarySendTimeOptimizer(policies),
    validation: validateSendTimeOptimizerPolicies(policies)
  };
}

export function createSendTimeOptimizerChecklist(snapshot = buildSendTimeOptimizerSnapshot()) {
  return [
    { id: 'send-time-optimizer-check-1', label: 'Brief scope', ok: snapshot.summary.metricCount >= 3 },
    { id: 'send-time-optimizer-check-2', label: 'Policy depth', ok: snapshot.validation.ok },
    { id: 'send-time-optimizer-check-3', label: 'Narratives ready', ok: snapshot.narratives.length >= 4 }
  ];
}

export function createSendTimeOptimizerApiDocument(snapshot = buildSendTimeOptimizerSnapshot()) {
  return {
    id: 'send-time-optimizer-api',
    headline: snapshot.summary.name + ' API contract',
    endpoints: [
      { method: 'GET', path: '/api/send-time-optimizer/overview' },
      { method: 'POST', path: '/api/send-time-optimizer/validate' },
      { method: 'GET', path: '/api/send-time-optimizer/policies' }
    ],
    checklist: createSendTimeOptimizerChecklist(snapshot)
  };
}
