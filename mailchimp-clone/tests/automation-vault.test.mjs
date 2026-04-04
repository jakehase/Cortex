import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAutomationVaultSnapshot, createAutomationVaultDashboardRoutes, createAutomationVaultApiRoutes, createAutomationVaultOpsRoutes, createAutomationVaultPublicRoutes, createAutomationVaultRegistryRoutes, summarizeAutomationVaultFixtures } from '../packages/automation-vault/index.mjs';

test('automation-vault generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAutomationVaultSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAutomationVaultDashboardRoutes().length, 3);
  assert.equal(createAutomationVaultApiRoutes().length, 4);
  assert.equal(createAutomationVaultOpsRoutes().length, 3);
  assert.equal(createAutomationVaultPublicRoutes().length, 3);
  assert.equal(createAutomationVaultRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAutomationVaultFixtures().contacts, 2);
});

