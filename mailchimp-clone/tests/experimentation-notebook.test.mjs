import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExperimentationNotebookSnapshot, createExperimentationNotebookDashboardRoutes, createExperimentationNotebookApiRoutes, createExperimentationNotebookOpsRoutes, createExperimentationNotebookPublicRoutes, createExperimentationNotebookRegistryRoutes, summarizeExperimentationNotebookFixtures } from '../packages/experimentation-notebook/index.mjs';

test('experimentation-notebook generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildExperimentationNotebookSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createExperimentationNotebookDashboardRoutes().length, 3);
  assert.equal(createExperimentationNotebookApiRoutes().length, 4);
  assert.equal(createExperimentationNotebookOpsRoutes().length, 3);
  assert.equal(createExperimentationNotebookPublicRoutes().length, 3);
  assert.equal(createExperimentationNotebookRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeExperimentationNotebookFixtures().contacts, 2);
});

