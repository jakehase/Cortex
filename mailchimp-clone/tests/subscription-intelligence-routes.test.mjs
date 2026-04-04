import test from 'node:test';
import assert from 'node:assert/strict';
import { createSubscriptionIntelligenceDashboardRoutes, createSubscriptionIntelligenceApiRoutes, createSubscriptionIntelligenceOpsRoutes, createSubscriptionIntelligencePublicRoutes } from '../packages/subscription-intelligence/index.mjs';

test('subscription-intelligence routes honor custom base paths and stable ids', () => {
  const dashboard = createSubscriptionIntelligenceDashboardRoutes('/labs/subscription-intelligence');
  const api = createSubscriptionIntelligenceApiRoutes('/api/labs/subscription-intelligence');
  const ops = createSubscriptionIntelligenceOpsRoutes('/ops/labs/subscription-intelligence');
  const pub = createSubscriptionIntelligencePublicRoutes('/public/labs/subscription-intelligence');
  assert.equal(dashboard[0].path, '/labs/subscription-intelligence');
  assert.equal(api[0].path, '/api/labs/subscription-intelligence/overview');
  assert.equal(ops[0].path, '/ops/labs/subscription-intelligence/health');
  assert.equal(pub[0].path, '/public/labs/subscription-intelligence');
  assert.match(dashboard[0].id, /subscription\-intelligence/);
  assert.match(api[2].id, /subscription\-intelligence/);
});

