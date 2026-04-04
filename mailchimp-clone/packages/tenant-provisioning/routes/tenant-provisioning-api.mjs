import { buildTenantProvisioningSnapshot, createTenantProvisioningApiDocument } from '../service-tenant-provisioning.mjs';

export function createTenantProvisioningApiRoutes(basePath = '/api/tenant-provisioning') {
  const snapshot = buildTenantProvisioningSnapshot();
  return [
    { id: 'tenant-provisioning.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary },
    { id: 'tenant-provisioning.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation },
    { id: 'tenant-provisioning.api.document', method: 'GET', path: basePath + '/document', document: createTenantProvisioningApiDocument(snapshot) }
  ];
}
