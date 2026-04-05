import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBillingNavigatorSnapshot, createBillingNavigatorDashboardRoutes, createBillingNavigatorApiRoutes, createBillingNavigatorOpsRoutes, createBillingNavigatorPublicRoutes, createBillingNavigatorRegistryRoutes, summarizeBillingNavigatorFixtures } from '../packages/billing-navigator/index.mjs';

test('billing-navigator generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildBillingNavigatorSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createBillingNavigatorDashboardRoutes().length, 3);
  assert.equal(createBillingNavigatorApiRoutes().length, 4);
  assert.equal(createBillingNavigatorOpsRoutes().length, 3);
  assert.equal(createBillingNavigatorPublicRoutes().length, 3);
  assert.equal(createBillingNavigatorRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeBillingNavigatorFixtures().contacts, 2);
});

