import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDataVaultSnapshot, createDataVaultDashboardRoutes, createDataVaultApiRoutes, createDataVaultOpsRoutes, createDataVaultPublicRoutes, createDataVaultRegistryRoutes, summarizeDataVaultFixtures } from '../packages/data-vault/index.mjs';

test('data-vault generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildDataVaultSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createDataVaultDashboardRoutes().length, 3);
  assert.equal(createDataVaultApiRoutes().length, 4);
  assert.equal(createDataVaultOpsRoutes().length, 3);
  assert.equal(createDataVaultPublicRoutes().length, 3);
  assert.equal(createDataVaultRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeDataVaultFixtures().contacts, 2);
});

