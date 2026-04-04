import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEngagementForecastingSnapshot, createEngagementForecastingDashboardRoutes, createEngagementForecastingApiRoutes, createEngagementForecastingOpsRoutes, createEngagementForecastingPublicRoutes, summarizeEngagementForecastingFixtures } from '../packages/engagement-forecasting/index.mjs';

test('engagement-forecasting package expands the real-repo wave with route catalogs', () => {
  const snapshot = buildEngagementForecastingSnapshot('Wave 6 Anchor');
  assert.equal(snapshot.summary.workspaceName, 'Wave 6 Anchor');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createEngagementForecastingDashboardRoutes().length, 3);
  assert.equal(createEngagementForecastingApiRoutes().length, 3);
  assert.equal(createEngagementForecastingOpsRoutes().length, 3);
  assert.equal(createEngagementForecastingPublicRoutes().length, 3);
  assert.equal(summarizeEngagementForecastingFixtures().contacts, 2);
});

