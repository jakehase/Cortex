import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEcommerceStudioSnapshot, createEcommerceStudioDashboardRoutes, createEcommerceStudioApiRoutes, createEcommerceStudioOpsRoutes, createEcommerceStudioPublicRoutes, createEcommerceStudioRegistryRoutes, summarizeEcommerceStudioFixtures } from '../packages/ecommerce-studio/index.mjs';

test('ecommerce-studio generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildEcommerceStudioSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createEcommerceStudioDashboardRoutes().length, 3);
  assert.equal(createEcommerceStudioApiRoutes().length, 4);
  assert.equal(createEcommerceStudioOpsRoutes().length, 3);
  assert.equal(createEcommerceStudioPublicRoutes().length, 3);
  assert.equal(createEcommerceStudioRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeEcommerceStudioFixtures().contacts, 2);
});

