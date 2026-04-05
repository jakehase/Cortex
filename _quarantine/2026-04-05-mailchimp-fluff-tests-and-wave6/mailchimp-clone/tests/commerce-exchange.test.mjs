import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCommerceExchangeSnapshot, createCommerceExchangeDashboardRoutes, createCommerceExchangeApiRoutes, createCommerceExchangeOpsRoutes, createCommerceExchangePublicRoutes, createCommerceExchangeRegistryRoutes, summarizeCommerceExchangeFixtures } from '../packages/commerce-exchange/index.mjs';

test('commerce-exchange generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCommerceExchangeSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCommerceExchangeDashboardRoutes().length, 3);
  assert.equal(createCommerceExchangeApiRoutes().length, 4);
  assert.equal(createCommerceExchangeOpsRoutes().length, 3);
  assert.equal(createCommerceExchangePublicRoutes().length, 3);
  assert.equal(createCommerceExchangeRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCommerceExchangeFixtures().contacts, 2);
});

