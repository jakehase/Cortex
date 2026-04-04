import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEcommerceExchangeSnapshot, createEcommerceExchangeDashboardRoutes, createEcommerceExchangeApiRoutes, createEcommerceExchangeOpsRoutes, createEcommerceExchangePublicRoutes, createEcommerceExchangeRegistryRoutes, summarizeEcommerceExchangeFixtures } from '../packages/ecommerce-exchange/index.mjs';

test('ecommerce-exchange generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildEcommerceExchangeSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createEcommerceExchangeDashboardRoutes().length, 3);
  assert.equal(createEcommerceExchangeApiRoutes().length, 4);
  assert.equal(createEcommerceExchangeOpsRoutes().length, 3);
  assert.equal(createEcommerceExchangePublicRoutes().length, 3);
  assert.equal(createEcommerceExchangeRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeEcommerceExchangeFixtures().contacts, 2);
});

