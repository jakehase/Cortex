import { createBillingRecoveryWorkspace, summarizeBillingRecovery, createBillingRecoveryNarratives } from './domain-billing-recovery.mjs';
import { createBillingRecoveryPolicies, validateBillingRecoveryPolicies, policySummaryBillingRecovery } from './domain-billing-recovery-policies.mjs';

export function buildBillingRecoverySnapshot(workspaceName = 'Continuation workspace') {
  const workspace = createBillingRecoveryWorkspace(workspaceName);
  const policies = createBillingRecoveryPolicies();
  return { workspace, summary: summarizeBillingRecovery(workspace), narratives: createBillingRecoveryNarratives(workspace), policies, policySummary: policySummaryBillingRecovery(policies), validation: validateBillingRecoveryPolicies(policies) };
}

export function createBillingRecoveryChecklist(snapshot = buildBillingRecoverySnapshot()) {
  return [
    { id: 'billing-recovery-check-1', label: 'Scope visible', ok: snapshot.summary.metricCount >= 3 },
    { id: 'billing-recovery-check-2', label: 'Policy depth', ok: snapshot.validation.ok },
    { id: 'billing-recovery-check-3', label: 'Narratives available', ok: snapshot.narratives.length >= 4 }
  ];
}

export function createBillingRecoveryApiDocument(snapshot = buildBillingRecoverySnapshot()) {
  return { id: 'billing-recovery-api', headline: snapshot.summary.name + ' API contract', endpoints: [{ method: 'GET', path: '/api/billing-recovery/overview' }, { method: 'POST', path: '/api/billing-recovery/validate' }, { method: 'GET', path: '/api/billing-recovery/policies' }], checklist: createBillingRecoveryChecklist(snapshot) };
}
