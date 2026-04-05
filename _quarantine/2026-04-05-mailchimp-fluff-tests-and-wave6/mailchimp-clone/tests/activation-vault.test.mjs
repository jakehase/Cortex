import test from 'node:test';
import assert from 'node:assert/strict';
import { buildActivationVaultSnapshot, createActivationVaultDashboardRoutes, createActivationVaultApiRoutes, createActivationVaultOpsRoutes, createActivationVaultPublicRoutes, createActivationVaultRegistryRoutes, summarizeActivationVaultFixtures } from '../packages/activation-vault/index.mjs';

test('activation-vault generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildActivationVaultSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createActivationVaultDashboardRoutes().length, 3);
  assert.equal(createActivationVaultApiRoutes().length, 4);
  assert.equal(createActivationVaultOpsRoutes().length, 3);
  assert.equal(createActivationVaultPublicRoutes().length, 3);
  assert.equal(createActivationVaultRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeActivationVaultFixtures().contacts, 2);
});

