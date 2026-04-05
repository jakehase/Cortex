import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBillingHubSnapshot, createBillingHubDashboardRoutes, createBillingHubApiRoutes, createBillingHubOpsRoutes, createBillingHubPublicRoutes, createBillingHubRegistryRoutes, summarizeBillingHubFixtures } from '../packages/billing-hub/index.mjs';

test('billing-hub generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildBillingHubSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createBillingHubDashboardRoutes().length, 3);
  assert.equal(createBillingHubApiRoutes().length, 4);
  assert.equal(createBillingHubOpsRoutes().length, 3);
  assert.equal(createBillingHubPublicRoutes().length, 3);
  assert.equal(createBillingHubRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeBillingHubFixtures().contacts, 2);
});

