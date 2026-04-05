import test from 'node:test';
import assert from 'node:assert/strict';
import { buildComplianceVaultSnapshot, createComplianceVaultDashboardRoutes, createComplianceVaultApiRoutes, createComplianceVaultOpsRoutes, createComplianceVaultPublicRoutes, createComplianceVaultRegistryRoutes, summarizeComplianceVaultFixtures } from '../packages/compliance-vault/index.mjs';

test('compliance-vault generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildComplianceVaultSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createComplianceVaultDashboardRoutes().length, 3);
  assert.equal(createComplianceVaultApiRoutes().length, 4);
  assert.equal(createComplianceVaultOpsRoutes().length, 3);
  assert.equal(createComplianceVaultPublicRoutes().length, 3);
  assert.equal(createComplianceVaultRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeComplianceVaultFixtures().contacts, 2);
});

