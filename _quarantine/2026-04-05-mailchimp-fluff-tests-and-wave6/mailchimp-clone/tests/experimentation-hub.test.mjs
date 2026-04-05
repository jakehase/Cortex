import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExperimentationHubSnapshot, createExperimentationHubDashboardRoutes, createExperimentationHubApiRoutes, createExperimentationHubOpsRoutes, createExperimentationHubPublicRoutes, createExperimentationHubRegistryRoutes, summarizeExperimentationHubFixtures } from '../packages/experimentation-hub/index.mjs';

test('experimentation-hub generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildExperimentationHubSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createExperimentationHubDashboardRoutes().length, 3);
  assert.equal(createExperimentationHubApiRoutes().length, 4);
  assert.equal(createExperimentationHubOpsRoutes().length, 3);
  assert.equal(createExperimentationHubPublicRoutes().length, 3);
  assert.equal(createExperimentationHubRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeExperimentationHubFixtures().contacts, 2);
});

