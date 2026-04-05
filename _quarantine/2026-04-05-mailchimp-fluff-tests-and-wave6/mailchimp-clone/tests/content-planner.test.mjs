import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContentPlannerSnapshot, createContentPlannerDashboardRoutes, createContentPlannerApiRoutes, createContentPlannerOpsRoutes, createContentPlannerPublicRoutes, createContentPlannerRegistryRoutes, summarizeContentPlannerFixtures } from '../packages/content-planner/index.mjs';

test('content-planner generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildContentPlannerSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createContentPlannerDashboardRoutes().length, 3);
  assert.equal(createContentPlannerApiRoutes().length, 4);
  assert.equal(createContentPlannerOpsRoutes().length, 3);
  assert.equal(createContentPlannerPublicRoutes().length, 3);
  assert.equal(createContentPlannerRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeContentPlannerFixtures().contacts, 2);
});

