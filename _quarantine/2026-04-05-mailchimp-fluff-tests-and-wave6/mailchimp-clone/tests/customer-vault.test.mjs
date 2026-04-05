import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCustomerVaultSnapshot, createCustomerVaultDashboardRoutes, createCustomerVaultApiRoutes, createCustomerVaultOpsRoutes, createCustomerVaultPublicRoutes, createCustomerVaultRegistryRoutes, summarizeCustomerVaultFixtures } from '../packages/customer-vault/index.mjs';

test('customer-vault generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCustomerVaultSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCustomerVaultDashboardRoutes().length, 3);
  assert.equal(createCustomerVaultApiRoutes().length, 4);
  assert.equal(createCustomerVaultOpsRoutes().length, 3);
  assert.equal(createCustomerVaultPublicRoutes().length, 3);
  assert.equal(createCustomerVaultRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCustomerVaultFixtures().contacts, 2);
});

