import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBillingExchangeSnapshot, createBillingExchangeDashboardRoutes, createBillingExchangeApiRoutes, createBillingExchangeOpsRoutes, createBillingExchangePublicRoutes, createBillingExchangeRegistryRoutes, summarizeBillingExchangeFixtures } from '../packages/billing-exchange/index.mjs';

test('billing-exchange generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildBillingExchangeSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createBillingExchangeDashboardRoutes().length, 3);
  assert.equal(createBillingExchangeApiRoutes().length, 4);
  assert.equal(createBillingExchangeOpsRoutes().length, 3);
  assert.equal(createBillingExchangePublicRoutes().length, 3);
  assert.equal(createBillingExchangeRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeBillingExchangeFixtures().contacts, 2);
});

