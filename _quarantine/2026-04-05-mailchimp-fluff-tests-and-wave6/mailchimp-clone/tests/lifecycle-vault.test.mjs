import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLifecycleVaultSnapshot, createLifecycleVaultDashboardRoutes, createLifecycleVaultApiRoutes, createLifecycleVaultOpsRoutes, createLifecycleVaultPublicRoutes, createLifecycleVaultRegistryRoutes, summarizeLifecycleVaultFixtures } from '../packages/lifecycle-vault/index.mjs';

test('lifecycle-vault generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildLifecycleVaultSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createLifecycleVaultDashboardRoutes().length, 3);
  assert.equal(createLifecycleVaultApiRoutes().length, 4);
  assert.equal(createLifecycleVaultOpsRoutes().length, 3);
  assert.equal(createLifecycleVaultPublicRoutes().length, 3);
  assert.equal(createLifecycleVaultRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeLifecycleVaultFixtures().contacts, 2);
});

