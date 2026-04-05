import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAttributionVaultSnapshot, createAttributionVaultDashboardRoutes, createAttributionVaultApiRoutes, createAttributionVaultOpsRoutes, createAttributionVaultPublicRoutes, createAttributionVaultRegistryRoutes, summarizeAttributionVaultFixtures } from '../packages/attribution-vault/index.mjs';

test('attribution-vault generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAttributionVaultSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAttributionVaultDashboardRoutes().length, 3);
  assert.equal(createAttributionVaultApiRoutes().length, 4);
  assert.equal(createAttributionVaultOpsRoutes().length, 3);
  assert.equal(createAttributionVaultPublicRoutes().length, 3);
  assert.equal(createAttributionVaultRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAttributionVaultFixtures().contacts, 2);
});

