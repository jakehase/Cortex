import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAdvocacyPlannerSnapshot, createAdvocacyPlannerDashboardRoutes, createAdvocacyPlannerApiRoutes, createAdvocacyPlannerOpsRoutes, createAdvocacyPlannerPublicRoutes, createAdvocacyPlannerRegistryRoutes, summarizeAdvocacyPlannerFixtures } from '../packages/advocacy-planner/index.mjs';

test('advocacy-planner generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAdvocacyPlannerSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAdvocacyPlannerDashboardRoutes().length, 3);
  assert.equal(createAdvocacyPlannerApiRoutes().length, 4);
  assert.equal(createAdvocacyPlannerOpsRoutes().length, 3);
  assert.equal(createAdvocacyPlannerPublicRoutes().length, 3);
  assert.equal(createAdvocacyPlannerRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAdvocacyPlannerFixtures().contacts, 2);
});

