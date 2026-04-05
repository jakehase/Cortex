import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLoyaltyExchangeSnapshot, createLoyaltyExchangeDashboardRoutes, createLoyaltyExchangeApiRoutes, createLoyaltyExchangeOpsRoutes, createLoyaltyExchangePublicRoutes, createLoyaltyExchangeRegistryRoutes, summarizeLoyaltyExchangeFixtures } from '../packages/loyalty-exchange/index.mjs';

test('loyalty-exchange generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildLoyaltyExchangeSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createLoyaltyExchangeDashboardRoutes().length, 3);
  assert.equal(createLoyaltyExchangeApiRoutes().length, 4);
  assert.equal(createLoyaltyExchangeOpsRoutes().length, 3);
  assert.equal(createLoyaltyExchangePublicRoutes().length, 3);
  assert.equal(createLoyaltyExchangeRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeLoyaltyExchangeFixtures().contacts, 2);
});

