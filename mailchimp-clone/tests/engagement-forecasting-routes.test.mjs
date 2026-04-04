import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngagementForecastingDashboardRoutes, createEngagementForecastingApiRoutes, createEngagementForecastingOpsRoutes, createEngagementForecastingPublicRoutes } from '../packages/engagement-forecasting/index.mjs';

test('engagement-forecasting routes honor custom base paths and stable ids', () => {
  const dashboard = createEngagementForecastingDashboardRoutes('/labs/engagement-forecasting');
  const api = createEngagementForecastingApiRoutes('/api/labs/engagement-forecasting');
  const ops = createEngagementForecastingOpsRoutes('/ops/labs/engagement-forecasting');
  const pub = createEngagementForecastingPublicRoutes('/public/labs/engagement-forecasting');
  assert.equal(dashboard[0].path, '/labs/engagement-forecasting');
  assert.equal(api[0].path, '/api/labs/engagement-forecasting/overview');
  assert.equal(ops[0].path, '/ops/labs/engagement-forecasting/health');
  assert.equal(pub[0].path, '/public/labs/engagement-forecasting');
  assert.match(dashboard[0].id, /engagement\-forecasting/);
  assert.match(api[2].id, /engagement\-forecasting/);
});

