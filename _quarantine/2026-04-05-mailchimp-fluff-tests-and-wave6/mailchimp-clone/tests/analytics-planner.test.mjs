import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAnalyticsPlannerSnapshot, createAnalyticsPlannerDashboardRoutes, createAnalyticsPlannerApiRoutes, createAnalyticsPlannerOpsRoutes, createAnalyticsPlannerPublicRoutes, createAnalyticsPlannerRegistryRoutes, summarizeAnalyticsPlannerFixtures } from '../packages/analytics-planner/index.mjs';

test('analytics-planner generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAnalyticsPlannerSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAnalyticsPlannerDashboardRoutes().length, 3);
  assert.equal(createAnalyticsPlannerApiRoutes().length, 4);
  assert.equal(createAnalyticsPlannerOpsRoutes().length, 3);
  assert.equal(createAnalyticsPlannerPublicRoutes().length, 3);
  assert.equal(createAnalyticsPlannerRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAnalyticsPlannerFixtures().contacts, 2);
});

