import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAttributionPlannerSnapshot, createAttributionPlannerDashboardRoutes, createAttributionPlannerApiRoutes, createAttributionPlannerOpsRoutes, createAttributionPlannerPublicRoutes, createAttributionPlannerRegistryRoutes, summarizeAttributionPlannerFixtures } from '../packages/attribution-planner/index.mjs';

test('attribution-planner generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAttributionPlannerSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAttributionPlannerDashboardRoutes().length, 3);
  assert.equal(createAttributionPlannerApiRoutes().length, 4);
  assert.equal(createAttributionPlannerOpsRoutes().length, 3);
  assert.equal(createAttributionPlannerPublicRoutes().length, 3);
  assert.equal(createAttributionPlannerRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAttributionPlannerFixtures().contacts, 2);
});

