import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAdvocacyVaultSnapshot, createAdvocacyVaultDashboardRoutes, createAdvocacyVaultApiRoutes, createAdvocacyVaultOpsRoutes, createAdvocacyVaultPublicRoutes, createAdvocacyVaultRegistryRoutes, summarizeAdvocacyVaultFixtures } from '../packages/advocacy-vault/index.mjs';

test('advocacy-vault generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAdvocacyVaultSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAdvocacyVaultDashboardRoutes().length, 3);
  assert.equal(createAdvocacyVaultApiRoutes().length, 4);
  assert.equal(createAdvocacyVaultOpsRoutes().length, 3);
  assert.equal(createAdvocacyVaultPublicRoutes().length, 3);
  assert.equal(createAdvocacyVaultRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAdvocacyVaultFixtures().contacts, 2);
});

