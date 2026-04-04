import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEcommerceIndexSnapshot, createEcommerceIndexDashboardRoutes, createEcommerceIndexApiRoutes, createEcommerceIndexOpsRoutes, createEcommerceIndexPublicRoutes, createEcommerceIndexRegistryRoutes, summarizeEcommerceIndexFixtures } from '../packages/ecommerce-index/index.mjs';

test('ecommerce-index generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildEcommerceIndexSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createEcommerceIndexDashboardRoutes().length, 3);
  assert.equal(createEcommerceIndexApiRoutes().length, 4);
  assert.equal(createEcommerceIndexOpsRoutes().length, 3);
  assert.equal(createEcommerceIndexPublicRoutes().length, 3);
  assert.equal(createEcommerceIndexRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeEcommerceIndexFixtures().contacts, 2);
});

