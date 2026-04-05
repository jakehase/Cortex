import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDataPlannerSnapshot, createDataPlannerDashboardRoutes, createDataPlannerApiRoutes, createDataPlannerOpsRoutes, createDataPlannerPublicRoutes, createDataPlannerRegistryRoutes, summarizeDataPlannerFixtures } from '../packages/data-planner/index.mjs';

test('data-planner generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildDataPlannerSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createDataPlannerDashboardRoutes().length, 3);
  assert.equal(createDataPlannerApiRoutes().length, 4);
  assert.equal(createDataPlannerOpsRoutes().length, 3);
  assert.equal(createDataPlannerPublicRoutes().length, 3);
  assert.equal(createDataPlannerRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeDataPlannerFixtures().contacts, 2);
});

