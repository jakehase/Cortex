import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTenantProvisioningSnapshot, createTenantProvisioningDashboardRoutes, createTenantProvisioningApiRoutes, createTenantProvisioningOpsRoutes, createTenantProvisioningPublicRoutes, summarizeTenantProvisioningFixtures } from '../packages/tenant-provisioning/index.mjs';

test('tenant-provisioning package exposes snapshot, policy, route, and fixture depth', () => {
  const snapshot = buildTenantProvisioningSnapshot('Anchor Expansion');
  assert.equal(snapshot.summary.workspaceName, 'Anchor Expansion');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createTenantProvisioningDashboardRoutes().length, 3);
  assert.equal(createTenantProvisioningApiRoutes().length, 3);
  assert.equal(createTenantProvisioningOpsRoutes().length, 3);
  assert.equal(createTenantProvisioningPublicRoutes().length, 3);
  assert.equal(summarizeTenantProvisioningFixtures().contacts, 2);
});
