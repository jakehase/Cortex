import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInsightsPlannerSnapshot, createInsightsPlannerDashboardRoutes, createInsightsPlannerApiRoutes, createInsightsPlannerOpsRoutes, createInsightsPlannerPublicRoutes, createInsightsPlannerRegistryRoutes, summarizeInsightsPlannerFixtures } from '../packages/insights-planner/index.mjs';

test('insights-planner generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildInsightsPlannerSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createInsightsPlannerDashboardRoutes().length, 3);
  assert.equal(createInsightsPlannerApiRoutes().length, 4);
  assert.equal(createInsightsPlannerOpsRoutes().length, 3);
  assert.equal(createInsightsPlannerPublicRoutes().length, 3);
  assert.equal(createInsightsPlannerRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeInsightsPlannerFixtures().contacts, 2);
});

