import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEcommerceFoundrySnapshot, createEcommerceFoundryDashboardRoutes, createEcommerceFoundryApiRoutes, createEcommerceFoundryOpsRoutes, createEcommerceFoundryPublicRoutes, createEcommerceFoundryRegistryRoutes, summarizeEcommerceFoundryFixtures } from '../packages/ecommerce-foundry/index.mjs';

test('ecommerce-foundry generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildEcommerceFoundrySnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createEcommerceFoundryDashboardRoutes().length, 3);
  assert.equal(createEcommerceFoundryApiRoutes().length, 4);
  assert.equal(createEcommerceFoundryOpsRoutes().length, 3);
  assert.equal(createEcommerceFoundryPublicRoutes().length, 3);
  assert.equal(createEcommerceFoundryRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeEcommerceFoundryFixtures().contacts, 2);
});

