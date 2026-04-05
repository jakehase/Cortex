import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEcommerceVaultSnapshot, createEcommerceVaultDashboardRoutes, createEcommerceVaultApiRoutes, createEcommerceVaultOpsRoutes, createEcommerceVaultPublicRoutes, createEcommerceVaultRegistryRoutes, summarizeEcommerceVaultFixtures } from '../packages/ecommerce-vault/index.mjs';

test('ecommerce-vault generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildEcommerceVaultSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createEcommerceVaultDashboardRoutes().length, 3);
  assert.equal(createEcommerceVaultApiRoutes().length, 4);
  assert.equal(createEcommerceVaultOpsRoutes().length, 3);
  assert.equal(createEcommerceVaultPublicRoutes().length, 3);
  assert.equal(createEcommerceVaultRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeEcommerceVaultFixtures().contacts, 2);
});

