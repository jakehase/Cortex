import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExperimentationIndexSnapshot, createExperimentationIndexDashboardRoutes, createExperimentationIndexApiRoutes, createExperimentationIndexOpsRoutes, createExperimentationIndexPublicRoutes, createExperimentationIndexRegistryRoutes, summarizeExperimentationIndexFixtures } from '../packages/experimentation-index/index.mjs';

test('experimentation-index generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildExperimentationIndexSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createExperimentationIndexDashboardRoutes().length, 3);
  assert.equal(createExperimentationIndexApiRoutes().length, 4);
  assert.equal(createExperimentationIndexOpsRoutes().length, 3);
  assert.equal(createExperimentationIndexPublicRoutes().length, 3);
  assert.equal(createExperimentationIndexRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeExperimentationIndexFixtures().contacts, 2);
});

