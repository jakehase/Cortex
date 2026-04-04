import { buildTenantProvisioningSnapshot, createTenantProvisioningChecklist } from '../service-tenant-provisioning.mjs';

export function createTenantProvisioningOpsRoutes(basePath = '/ops/tenant-provisioning') {
  const snapshot = buildTenantProvisioningSnapshot();
  return [
    { id: 'tenant-provisioning.ops.health', method: 'GET', path: basePath + '/health', checklist: createTenantProvisioningChecklist(snapshot) },
    { id: 'tenant-provisioning.ops.policies', method: 'GET', path: basePath + '/policies', policies: snapshot.policies },
    { id: 'tenant-provisioning.ops.metrics', method: 'GET', path: basePath + '/metrics', scorecards: snapshot.workspace.scorecards }
  ];
}
