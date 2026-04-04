import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEcommerceNavigatorSnapshot, createEcommerceNavigatorDashboardRoutes, createEcommerceNavigatorApiRoutes, createEcommerceNavigatorOpsRoutes, createEcommerceNavigatorPublicRoutes, createEcommerceNavigatorRegistryRoutes, summarizeEcommerceNavigatorFixtures } from '../packages/ecommerce-navigator/index.mjs';

test('ecommerce-navigator generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildEcommerceNavigatorSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createEcommerceNavigatorDashboardRoutes().length, 3);
  assert.equal(createEcommerceNavigatorApiRoutes().length, 4);
  assert.equal(createEcommerceNavigatorOpsRoutes().length, 3);
  assert.equal(createEcommerceNavigatorPublicRoutes().length, 3);
  assert.equal(createEcommerceNavigatorRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeEcommerceNavigatorFixtures().contacts, 2);
});

