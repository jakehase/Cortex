import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExperimentationFoundrySnapshot, createExperimentationFoundryDashboardRoutes, createExperimentationFoundryApiRoutes, createExperimentationFoundryOpsRoutes, createExperimentationFoundryPublicRoutes, createExperimentationFoundryRegistryRoutes, summarizeExperimentationFoundryFixtures } from '../packages/experimentation-foundry/index.mjs';

test('experimentation-foundry generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildExperimentationFoundrySnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createExperimentationFoundryDashboardRoutes().length, 3);
  assert.equal(createExperimentationFoundryApiRoutes().length, 4);
  assert.equal(createExperimentationFoundryOpsRoutes().length, 3);
  assert.equal(createExperimentationFoundryPublicRoutes().length, 3);
  assert.equal(createExperimentationFoundryRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeExperimentationFoundryFixtures().contacts, 2);
});

