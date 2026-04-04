import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBillingFoundrySnapshot, createBillingFoundryDashboardRoutes, createBillingFoundryApiRoutes, createBillingFoundryOpsRoutes, createBillingFoundryPublicRoutes, createBillingFoundryRegistryRoutes, summarizeBillingFoundryFixtures } from '../packages/billing-foundry/index.mjs';

test('billing-foundry generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildBillingFoundrySnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createBillingFoundryDashboardRoutes().length, 3);
  assert.equal(createBillingFoundryApiRoutes().length, 4);
  assert.equal(createBillingFoundryOpsRoutes().length, 3);
  assert.equal(createBillingFoundryPublicRoutes().length, 3);
  assert.equal(createBillingFoundryRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeBillingFoundryFixtures().contacts, 2);
});

