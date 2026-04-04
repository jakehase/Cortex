import { buildTenantProvisioningSnapshot } from '../service-tenant-provisioning.mjs';
import { createTenantProvisioningFixtures } from '../fixtures-tenant-provisioning.mjs';

export function createTenantProvisioningPublicRoutes(basePath = '/public/tenant-provisioning') {
  const snapshot = buildTenantProvisioningSnapshot();
  const fixtures = createTenantProvisioningFixtures();
  return [
    { id: 'tenant-provisioning.public.summary', method: 'GET', path: basePath, focus: snapshot.summary.focus },
    { id: 'tenant-provisioning.public.catalog', method: 'GET', path: basePath + '/catalog', contacts: fixtures.contacts },
    { id: 'tenant-provisioning.public.notes', method: 'GET', path: basePath + '/notes', notes: fixtures.notes }
  ];
}
