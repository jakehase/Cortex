import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContentVaultSnapshot, createContentVaultDashboardRoutes, createContentVaultApiRoutes, createContentVaultOpsRoutes, createContentVaultPublicRoutes, createContentVaultRegistryRoutes, summarizeContentVaultFixtures } from '../packages/content-vault/index.mjs';

test('content-vault generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildContentVaultSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createContentVaultDashboardRoutes().length, 3);
  assert.equal(createContentVaultApiRoutes().length, 4);
  assert.equal(createContentVaultOpsRoutes().length, 3);
  assert.equal(createContentVaultPublicRoutes().length, 3);
  assert.equal(createContentVaultRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeContentVaultFixtures().contacts, 2);
});

