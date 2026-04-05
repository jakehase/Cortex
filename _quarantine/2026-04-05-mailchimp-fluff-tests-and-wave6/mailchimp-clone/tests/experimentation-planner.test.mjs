import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExperimentationPlannerSnapshot, createExperimentationPlannerDashboardRoutes, createExperimentationPlannerApiRoutes, createExperimentationPlannerOpsRoutes, createExperimentationPlannerPublicRoutes, createExperimentationPlannerRegistryRoutes, summarizeExperimentationPlannerFixtures } from '../packages/experimentation-planner/index.mjs';

test('experimentation-planner generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildExperimentationPlannerSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createExperimentationPlannerDashboardRoutes().length, 3);
  assert.equal(createExperimentationPlannerApiRoutes().length, 4);
  assert.equal(createExperimentationPlannerOpsRoutes().length, 3);
  assert.equal(createExperimentationPlannerPublicRoutes().length, 3);
  assert.equal(createExperimentationPlannerRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeExperimentationPlannerFixtures().contacts, 2);
});

