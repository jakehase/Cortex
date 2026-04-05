import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCreativeVaultSnapshot, createCreativeVaultDashboardRoutes, createCreativeVaultApiRoutes, createCreativeVaultOpsRoutes, createCreativeVaultPublicRoutes, createCreativeVaultRegistryRoutes, summarizeCreativeVaultFixtures } from '../packages/creative-vault/index.mjs';

test('creative-vault generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCreativeVaultSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCreativeVaultDashboardRoutes().length, 3);
  assert.equal(createCreativeVaultApiRoutes().length, 4);
  assert.equal(createCreativeVaultOpsRoutes().length, 3);
  assert.equal(createCreativeVaultPublicRoutes().length, 3);
  assert.equal(createCreativeVaultRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCreativeVaultFixtures().contacts, 2);
});

