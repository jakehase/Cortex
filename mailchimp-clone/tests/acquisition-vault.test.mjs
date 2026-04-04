import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAcquisitionVaultSnapshot, createAcquisitionVaultDashboardRoutes, createAcquisitionVaultApiRoutes, createAcquisitionVaultOpsRoutes, createAcquisitionVaultPublicRoutes, createAcquisitionVaultRegistryRoutes, summarizeAcquisitionVaultFixtures } from '../packages/acquisition-vault/index.mjs';

test('acquisition-vault generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAcquisitionVaultSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAcquisitionVaultDashboardRoutes().length, 3);
  assert.equal(createAcquisitionVaultApiRoutes().length, 4);
  assert.equal(createAcquisitionVaultOpsRoutes().length, 3);
  assert.equal(createAcquisitionVaultPublicRoutes().length, 3);
  assert.equal(createAcquisitionVaultRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAcquisitionVaultFixtures().contacts, 2);
});

