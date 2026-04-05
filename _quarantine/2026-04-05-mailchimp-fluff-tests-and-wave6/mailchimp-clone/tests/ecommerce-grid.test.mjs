import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEcommerceGridSnapshot, createEcommerceGridDashboardRoutes, createEcommerceGridApiRoutes, createEcommerceGridOpsRoutes, createEcommerceGridPublicRoutes, createEcommerceGridRegistryRoutes, summarizeEcommerceGridFixtures } from '../packages/ecommerce-grid/index.mjs';

test('ecommerce-grid generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildEcommerceGridSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createEcommerceGridDashboardRoutes().length, 3);
  assert.equal(createEcommerceGridApiRoutes().length, 4);
  assert.equal(createEcommerceGridOpsRoutes().length, 3);
  assert.equal(createEcommerceGridPublicRoutes().length, 3);
  assert.equal(createEcommerceGridRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeEcommerceGridFixtures().contacts, 2);
});

