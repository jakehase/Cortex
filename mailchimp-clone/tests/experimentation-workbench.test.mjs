import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExperimentationWorkbenchSnapshot, createExperimentationWorkbenchDashboardRoutes, createExperimentationWorkbenchApiRoutes, createExperimentationWorkbenchOpsRoutes, createExperimentationWorkbenchPublicRoutes, createExperimentationWorkbenchRegistryRoutes, summarizeExperimentationWorkbenchFixtures } from '../packages/experimentation-workbench/index.mjs';

test('experimentation-workbench generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildExperimentationWorkbenchSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createExperimentationWorkbenchDashboardRoutes().length, 3);
  assert.equal(createExperimentationWorkbenchApiRoutes().length, 4);
  assert.equal(createExperimentationWorkbenchOpsRoutes().length, 3);
  assert.equal(createExperimentationWorkbenchPublicRoutes().length, 3);
  assert.equal(createExperimentationWorkbenchRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeExperimentationWorkbenchFixtures().contacts, 2);
});

