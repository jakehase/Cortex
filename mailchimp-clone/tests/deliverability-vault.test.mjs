import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDeliverabilityVaultSnapshot, createDeliverabilityVaultDashboardRoutes, createDeliverabilityVaultApiRoutes, createDeliverabilityVaultOpsRoutes, createDeliverabilityVaultPublicRoutes, createDeliverabilityVaultRegistryRoutes, summarizeDeliverabilityVaultFixtures } from '../packages/deliverability-vault/index.mjs';

test('deliverability-vault generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildDeliverabilityVaultSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createDeliverabilityVaultDashboardRoutes().length, 3);
  assert.equal(createDeliverabilityVaultApiRoutes().length, 4);
  assert.equal(createDeliverabilityVaultOpsRoutes().length, 3);
  assert.equal(createDeliverabilityVaultPublicRoutes().length, 3);
  assert.equal(createDeliverabilityVaultRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeDeliverabilityVaultFixtures().contacts, 2);
});

