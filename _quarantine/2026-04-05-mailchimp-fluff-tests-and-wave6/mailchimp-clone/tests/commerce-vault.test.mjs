import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCommerceVaultSnapshot, createCommerceVaultDashboardRoutes, createCommerceVaultApiRoutes, createCommerceVaultOpsRoutes, createCommerceVaultPublicRoutes, createCommerceVaultRegistryRoutes, summarizeCommerceVaultFixtures } from '../packages/commerce-vault/index.mjs';

test('commerce-vault generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCommerceVaultSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCommerceVaultDashboardRoutes().length, 3);
  assert.equal(createCommerceVaultApiRoutes().length, 4);
  assert.equal(createCommerceVaultOpsRoutes().length, 3);
  assert.equal(createCommerceVaultPublicRoutes().length, 3);
  assert.equal(createCommerceVaultRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCommerceVaultFixtures().contacts, 2);
});

