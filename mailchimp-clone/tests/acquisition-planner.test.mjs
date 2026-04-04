import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAcquisitionPlannerSnapshot, createAcquisitionPlannerDashboardRoutes, createAcquisitionPlannerApiRoutes, createAcquisitionPlannerOpsRoutes, createAcquisitionPlannerPublicRoutes, createAcquisitionPlannerRegistryRoutes, summarizeAcquisitionPlannerFixtures } from '../packages/acquisition-planner/index.mjs';

test('acquisition-planner generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAcquisitionPlannerSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAcquisitionPlannerDashboardRoutes().length, 3);
  assert.equal(createAcquisitionPlannerApiRoutes().length, 4);
  assert.equal(createAcquisitionPlannerOpsRoutes().length, 3);
  assert.equal(createAcquisitionPlannerPublicRoutes().length, 3);
  assert.equal(createAcquisitionPlannerRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAcquisitionPlannerFixtures().contacts, 2);
});

