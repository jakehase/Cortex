import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRevenueAttributionSnapshot, createRevenueAttributionDashboardRoutes, createRevenueAttributionApiRoutes, createRevenueAttributionOpsRoutes, createRevenueAttributionPublicRoutes, summarizeRevenueAttributionFixtures } from '../packages/revenue-attribution/index.mjs';

test('revenue-attribution package expands the real-repo wave with route catalogs', () => {
  const snapshot = buildRevenueAttributionSnapshot('Wave 6 Anchor');
  assert.equal(snapshot.summary.workspaceName, 'Wave 6 Anchor');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createRevenueAttributionDashboardRoutes().length, 3);
  assert.equal(createRevenueAttributionApiRoutes().length, 3);
  assert.equal(createRevenueAttributionOpsRoutes().length, 3);
  assert.equal(createRevenueAttributionPublicRoutes().length, 3);
  assert.equal(summarizeRevenueAttributionFixtures().contacts, 2);
});

