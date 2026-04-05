import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIntegrationsVaultSnapshot, createIntegrationsVaultDashboardRoutes, createIntegrationsVaultApiRoutes, createIntegrationsVaultOpsRoutes, createIntegrationsVaultPublicRoutes, createIntegrationsVaultRegistryRoutes, summarizeIntegrationsVaultFixtures } from '../packages/integrations-vault/index.mjs';

test('integrations-vault generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildIntegrationsVaultSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createIntegrationsVaultDashboardRoutes().length, 3);
  assert.equal(createIntegrationsVaultApiRoutes().length, 4);
  assert.equal(createIntegrationsVaultOpsRoutes().length, 3);
  assert.equal(createIntegrationsVaultPublicRoutes().length, 3);
  assert.equal(createIntegrationsVaultRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeIntegrationsVaultFixtures().contacts, 2);
});

