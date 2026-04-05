import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExperimentationNavigatorSnapshot, createExperimentationNavigatorDashboardRoutes, createExperimentationNavigatorApiRoutes, createExperimentationNavigatorOpsRoutes, createExperimentationNavigatorPublicRoutes, createExperimentationNavigatorRegistryRoutes, summarizeExperimentationNavigatorFixtures } from '../packages/experimentation-navigator/index.mjs';

test('experimentation-navigator generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildExperimentationNavigatorSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createExperimentationNavigatorDashboardRoutes().length, 3);
  assert.equal(createExperimentationNavigatorApiRoutes().length, 4);
  assert.equal(createExperimentationNavigatorOpsRoutes().length, 3);
  assert.equal(createExperimentationNavigatorPublicRoutes().length, 3);
  assert.equal(createExperimentationNavigatorRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeExperimentationNavigatorFixtures().contacts, 2);
});

