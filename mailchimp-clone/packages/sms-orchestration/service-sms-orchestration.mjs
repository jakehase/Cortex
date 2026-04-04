import { createSmsOrchestrationWorkspace, summarizeSmsOrchestration, createSmsOrchestrationNarratives } from './domain-sms-orchestration.mjs';
import { createSmsOrchestrationPolicies, validateSmsOrchestrationPolicies, policySummarySmsOrchestration } from './domain-sms-orchestration-policies.mjs';

export function buildSmsOrchestrationSnapshot(workspaceName = 'Expansion workspace') {
  const workspace = createSmsOrchestrationWorkspace(workspaceName);
  const policies = createSmsOrchestrationPolicies();
  return {
    workspace,
    summary: summarizeSmsOrchestration(workspace),
    narratives: createSmsOrchestrationNarratives(workspace),
    policies,
    policySummary: policySummarySmsOrchestration(policies),
    validation: validateSmsOrchestrationPolicies(policies)
  };
}

export function createSmsOrchestrationChecklist(snapshot = buildSmsOrchestrationSnapshot()) {
  return [
    { id: 'sms-orchestration-check-1', label: 'Brief scope', ok: snapshot.summary.metricCount >= 3 },
    { id: 'sms-orchestration-check-2', label: 'Policy depth', ok: snapshot.validation.ok },
    { id: 'sms-orchestration-check-3', label: 'Narratives ready', ok: snapshot.narratives.length >= 4 }
  ];
}

export function createSmsOrchestrationApiDocument(snapshot = buildSmsOrchestrationSnapshot()) {
  return {
    id: 'sms-orchestration-api',
    headline: snapshot.summary.name + ' API contract',
    endpoints: [
      { method: 'GET', path: '/api/sms-orchestration/overview' },
      { method: 'POST', path: '/api/sms-orchestration/validate' },
      { method: 'GET', path: '/api/sms-orchestration/policies' }
    ],
    checklist: createSmsOrchestrationChecklist(snapshot)
  };
}
