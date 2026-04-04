import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBillingAnalyticsSnapshot, createBillingAnalyticsDashboardRoutes, createBillingAnalyticsApiRoutes, createBillingAnalyticsOpsRoutes, createBillingAnalyticsPublicRoutes, summarizeBillingAnalyticsFixtures } from '../packages/billing-analytics/index.mjs';

test('billing-analytics package exposes snapshot, policy, route, and fixture depth', () => {
  const snapshot = buildBillingAnalyticsSnapshot('Anchor Expansion');
  assert.equal(snapshot.summary.workspaceName, 'Anchor Expansion');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createBillingAnalyticsDashboardRoutes().length, 3);
  assert.equal(createBillingAnalyticsApiRoutes().length, 3);
  assert.equal(createBillingAnalyticsOpsRoutes().length, 3);
  assert.equal(createBillingAnalyticsPublicRoutes().length, 3);
  assert.equal(summarizeBillingAnalyticsFixtures().contacts, 2);
});
