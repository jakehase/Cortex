import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCommerceNavigatorSnapshot, createCommerceNavigatorDashboardRoutes, createCommerceNavigatorApiRoutes, createCommerceNavigatorOpsRoutes, createCommerceNavigatorPublicRoutes, createCommerceNavigatorRegistryRoutes, summarizeCommerceNavigatorFixtures } from '../packages/commerce-navigator/index.mjs';

test('commerce-navigator generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCommerceNavigatorSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCommerceNavigatorDashboardRoutes().length, 3);
  assert.equal(createCommerceNavigatorApiRoutes().length, 4);
  assert.equal(createCommerceNavigatorOpsRoutes().length, 3);
  assert.equal(createCommerceNavigatorPublicRoutes().length, 3);
  assert.equal(createCommerceNavigatorRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCommerceNavigatorFixtures().contacts, 2);
});

