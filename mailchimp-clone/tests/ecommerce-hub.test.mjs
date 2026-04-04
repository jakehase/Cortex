import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEcommerceHubSnapshot, createEcommerceHubDashboardRoutes, createEcommerceHubApiRoutes, createEcommerceHubOpsRoutes, createEcommerceHubPublicRoutes, createEcommerceHubRegistryRoutes, summarizeEcommerceHubFixtures } from '../packages/ecommerce-hub/index.mjs';

test('ecommerce-hub generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildEcommerceHubSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createEcommerceHubDashboardRoutes().length, 3);
  assert.equal(createEcommerceHubApiRoutes().length, 4);
  assert.equal(createEcommerceHubOpsRoutes().length, 3);
  assert.equal(createEcommerceHubPublicRoutes().length, 3);
  assert.equal(createEcommerceHubRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeEcommerceHubFixtures().contacts, 2);
});

