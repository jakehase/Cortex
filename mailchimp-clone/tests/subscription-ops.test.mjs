import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSubscriptionOpsSnapshot, createSubscriptionOpsDashboardRoutes, createSubscriptionOpsApiRoutes, createSubscriptionOpsOpsRoutes, createSubscriptionOpsPublicRoutes, summarizeSubscriptionOpsFixtures } from '../packages/subscription-ops/index.mjs';

test('subscription-ops package exposes snapshot, policy, route, and fixture depth', () => {
  const snapshot = buildSubscriptionOpsSnapshot('Anchor Expansion');
  assert.equal(snapshot.summary.workspaceName, 'Anchor Expansion');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createSubscriptionOpsDashboardRoutes().length, 3);
  assert.equal(createSubscriptionOpsApiRoutes().length, 3);
  assert.equal(createSubscriptionOpsOpsRoutes().length, 3);
  assert.equal(createSubscriptionOpsPublicRoutes().length, 3);
  assert.equal(summarizeSubscriptionOpsFixtures().contacts, 2);
});
