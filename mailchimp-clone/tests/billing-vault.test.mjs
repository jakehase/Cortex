import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBillingVaultSnapshot, createBillingVaultDashboardRoutes, createBillingVaultApiRoutes, createBillingVaultOpsRoutes, createBillingVaultPublicRoutes, createBillingVaultRegistryRoutes, summarizeBillingVaultFixtures } from '../packages/billing-vault/index.mjs';

test('billing-vault generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildBillingVaultSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createBillingVaultDashboardRoutes().length, 3);
  assert.equal(createBillingVaultApiRoutes().length, 4);
  assert.equal(createBillingVaultOpsRoutes().length, 3);
  assert.equal(createBillingVaultPublicRoutes().length, 3);
  assert.equal(createBillingVaultRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeBillingVaultFixtures().contacts, 2);
});

