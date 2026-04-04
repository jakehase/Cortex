import { buildTenantProvisioningSnapshot } from '../service-tenant-provisioning.mjs';

export function createTenantProvisioningDashboardRoutes(basePath = '/tenant-provisioning') {
  const snapshot = buildTenantProvisioningSnapshot();
  return [
    { id: 'tenant-provisioning.overview', method: 'GET', path: basePath, summary: snapshot.summary },
    { id: 'tenant-provisioning.programs', method: 'GET', path: basePath + '/programs', programs: snapshot.workspace.programs },
    { id: 'tenant-provisioning.narratives', method: 'GET', path: basePath + '/narratives', narratives: snapshot.narratives }
  ];
}
