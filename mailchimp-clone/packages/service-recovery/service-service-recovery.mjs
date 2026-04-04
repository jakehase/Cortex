import { createServiceRecoveryWorkspace, summarizeServiceRecovery, createServiceRecoveryNarratives } from './domain-service-recovery.mjs';
import { createServiceRecoveryPolicies, validateServiceRecoveryPolicies, policySummaryServiceRecovery } from './domain-service-recovery-policies.mjs';

export function buildServiceRecoverySnapshot(workspaceName = 'Wave 6 workspace') {
  const workspace = createServiceRecoveryWorkspace(workspaceName);
  const policies = createServiceRecoveryPolicies();
  return { workspace, summary: summarizeServiceRecovery(workspace), narratives: createServiceRecoveryNarratives(workspace), policies, policySummary: policySummaryServiceRecovery(policies), validation: validateServiceRecoveryPolicies(policies) };
}

export function createServiceRecoveryChecklist(snapshot = buildServiceRecoverySnapshot()) {
  return [
    { id: "service-recovery-check-1", label: 'Scope visible', ok: snapshot.summary.metricCount >= 3 },
    { id: "service-recovery-check-2", label: 'Policy depth', ok: snapshot.validation.ok },
    { id: "service-recovery-check-3", label: 'Narratives available', ok: snapshot.narratives.length >= 4 }
  ];
}

export function createServiceRecoveryApiDocument(snapshot = buildServiceRecoverySnapshot()) {
  return {
    id: "service-recovery-api",
    headline: snapshot.summary.name + ' API contract',
    endpoints: [
      { method: 'GET', path: '/api/service-recovery/overview' },
      { method: 'POST', path: '/api/service-recovery/validate' },
      { method: 'GET', path: '/api/service-recovery/policies' }
    ],
    checklist: createServiceRecoveryChecklist(snapshot)
  };
}

