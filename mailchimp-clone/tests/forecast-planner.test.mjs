import test from 'node:test';
import assert from 'node:assert/strict';
import { buildForecastPlannerSnapshot, createForecastPlannerDashboardRoutes, createForecastPlannerApiRoutes, createForecastPlannerOpsRoutes, createForecastPlannerPublicRoutes, summarizeForecastPlannerFixtures } from '../packages/forecast-planner/index.mjs';

test('forecast-planner package exposes snapshot, policy, route, and fixture depth', () => {
  const snapshot = buildForecastPlannerSnapshot('Anchor Expansion');
  assert.equal(snapshot.summary.workspaceName, 'Anchor Expansion');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createForecastPlannerDashboardRoutes().length, 3);
  assert.equal(createForecastPlannerApiRoutes().length, 3);
  assert.equal(createForecastPlannerOpsRoutes().length, 3);
  assert.equal(createForecastPlannerPublicRoutes().length, 3);
  assert.equal(summarizeForecastPlannerFixtures().contacts, 2);
});
