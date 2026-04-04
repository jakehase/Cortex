import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExperimentationWatchtowerSnapshot, createExperimentationWatchtowerDashboardRoutes, createExperimentationWatchtowerApiRoutes, createExperimentationWatchtowerOpsRoutes, createExperimentationWatchtowerPublicRoutes, createExperimentationWatchtowerRegistryRoutes, summarizeExperimentationWatchtowerFixtures } from '../packages/experimentation-watchtower/index.mjs';

test('experimentation-watchtower generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildExperimentationWatchtowerSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createExperimentationWatchtowerDashboardRoutes().length, 3);
  assert.equal(createExperimentationWatchtowerApiRoutes().length, 4);
  assert.equal(createExperimentationWatchtowerOpsRoutes().length, 3);
  assert.equal(createExperimentationWatchtowerPublicRoutes().length, 3);
  assert.equal(createExperimentationWatchtowerRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeExperimentationWatchtowerFixtures().contacts, 2);
});

