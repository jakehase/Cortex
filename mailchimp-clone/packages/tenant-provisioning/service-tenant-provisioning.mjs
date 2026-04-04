import { createTenantProvisioningWorkspace, summarizeTenantProvisioning, createTenantProvisioningNarratives } from './domain-tenant-provisioning.mjs';
import { createTenantProvisioningPolicies, validateTenantProvisioningPolicies, policySummaryTenantProvisioning } from './domain-tenant-provisioning-policies.mjs';

export function buildTenantProvisioningSnapshot(workspaceName = 'Expansion workspace') {
  const workspace = createTenantProvisioningWorkspace(workspaceName);
  const policies = createTenantProvisioningPolicies();
  return {
    workspace,
    summary: summarizeTenantProvisioning(workspace),
    narratives: createTenantProvisioningNarratives(workspace),
    policies,
    policySummary: policySummaryTenantProvisioning(policies),
    validation: validateTenantProvisioningPolicies(policies)
  };
}

export function createTenantProvisioningChecklist(snapshot = buildTenantProvisioningSnapshot()) {
  return [
    { id: 'tenant-provisioning-check-1', label: 'Brief scope', ok: snapshot.summary.metricCount >= 3 },
    { id: 'tenant-provisioning-check-2', label: 'Policy depth', ok: snapshot.validation.ok },
    { id: 'tenant-provisioning-check-3', label: 'Narratives ready', ok: snapshot.narratives.length >= 4 }
  ];
}

export function createTenantProvisioningApiDocument(snapshot = buildTenantProvisioningSnapshot()) {
  return {
    id: 'tenant-provisioning-api',
    headline: snapshot.summary.name + ' API contract',
    endpoints: [
      { method: 'GET', path: '/api/tenant-provisioning/overview' },
      { method: 'POST', path: '/api/tenant-provisioning/validate' },
      { method: 'GET', path: '/api/tenant-provisioning/policies' }
    ],
    checklist: createTenantProvisioningChecklist(snapshot)
  };
}
