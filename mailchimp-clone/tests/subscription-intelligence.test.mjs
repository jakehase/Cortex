import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSubscriptionIntelligenceSnapshot, createSubscriptionIntelligenceDashboardRoutes, createSubscriptionIntelligenceApiRoutes, createSubscriptionIntelligenceOpsRoutes, createSubscriptionIntelligencePublicRoutes, summarizeSubscriptionIntelligenceFixtures } from '../packages/subscription-intelligence/index.mjs';

test('subscription-intelligence package expands the real-repo wave with route catalogs', () => {
  const snapshot = buildSubscriptionIntelligenceSnapshot('Wave 6 Anchor');
  assert.equal(snapshot.summary.workspaceName, 'Wave 6 Anchor');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createSubscriptionIntelligenceDashboardRoutes().length, 3);
  assert.equal(createSubscriptionIntelligenceApiRoutes().length, 3);
  assert.equal(createSubscriptionIntelligenceOpsRoutes().length, 3);
  assert.equal(createSubscriptionIntelligencePublicRoutes().length, 3);
  assert.equal(summarizeSubscriptionIntelligenceFixtures().contacts, 2);
});

