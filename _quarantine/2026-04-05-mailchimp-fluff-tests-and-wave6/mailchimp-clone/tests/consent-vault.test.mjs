import test from 'node:test';
import assert from 'node:assert/strict';
import { buildConsentVaultSnapshot, createConsentVaultDashboardRoutes, createConsentVaultApiRoutes, createConsentVaultOpsRoutes, createConsentVaultPublicRoutes, createConsentVaultRegistryRoutes, summarizeConsentVaultFixtures } from '../packages/consent-vault/index.mjs';

test('consent-vault generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildConsentVaultSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createConsentVaultDashboardRoutes().length, 3);
  assert.equal(createConsentVaultApiRoutes().length, 4);
  assert.equal(createConsentVaultOpsRoutes().length, 3);
  assert.equal(createConsentVaultPublicRoutes().length, 3);
  assert.equal(createConsentVaultRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeConsentVaultFixtures().contacts, 2);
});

