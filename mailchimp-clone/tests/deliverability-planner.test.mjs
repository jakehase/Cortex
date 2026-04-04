import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDeliverabilityPlannerSnapshot, createDeliverabilityPlannerDashboardRoutes, createDeliverabilityPlannerApiRoutes, createDeliverabilityPlannerOpsRoutes, createDeliverabilityPlannerPublicRoutes, createDeliverabilityPlannerRegistryRoutes, summarizeDeliverabilityPlannerFixtures } from '../packages/deliverability-planner/index.mjs';

test('deliverability-planner generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildDeliverabilityPlannerSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createDeliverabilityPlannerDashboardRoutes().length, 3);
  assert.equal(createDeliverabilityPlannerApiRoutes().length, 4);
  assert.equal(createDeliverabilityPlannerOpsRoutes().length, 3);
  assert.equal(createDeliverabilityPlannerPublicRoutes().length, 3);
  assert.equal(createDeliverabilityPlannerRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeDeliverabilityPlannerFixtures().contacts, 2);
});

