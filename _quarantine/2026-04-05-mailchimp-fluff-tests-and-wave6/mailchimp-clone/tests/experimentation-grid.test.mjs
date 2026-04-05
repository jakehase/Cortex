import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExperimentationGridSnapshot, createExperimentationGridDashboardRoutes, createExperimentationGridApiRoutes, createExperimentationGridOpsRoutes, createExperimentationGridPublicRoutes, createExperimentationGridRegistryRoutes, summarizeExperimentationGridFixtures } from '../packages/experimentation-grid/index.mjs';

test('experimentation-grid generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildExperimentationGridSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createExperimentationGridDashboardRoutes().length, 3);
  assert.equal(createExperimentationGridApiRoutes().length, 4);
  assert.equal(createExperimentationGridOpsRoutes().length, 3);
  assert.equal(createExperimentationGridPublicRoutes().length, 3);
  assert.equal(createExperimentationGridRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeExperimentationGridFixtures().contacts, 2);
});

