import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLoyaltyVaultSnapshot, createLoyaltyVaultDashboardRoutes, createLoyaltyVaultApiRoutes, createLoyaltyVaultOpsRoutes, createLoyaltyVaultPublicRoutes, createLoyaltyVaultRegistryRoutes, summarizeLoyaltyVaultFixtures } from '../packages/loyalty-vault/index.mjs';

test('loyalty-vault generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildLoyaltyVaultSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createLoyaltyVaultDashboardRoutes().length, 3);
  assert.equal(createLoyaltyVaultApiRoutes().length, 4);
  assert.equal(createLoyaltyVaultOpsRoutes().length, 3);
  assert.equal(createLoyaltyVaultPublicRoutes().length, 3);
  assert.equal(createLoyaltyVaultRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeLoyaltyVaultFixtures().contacts, 2);
});

