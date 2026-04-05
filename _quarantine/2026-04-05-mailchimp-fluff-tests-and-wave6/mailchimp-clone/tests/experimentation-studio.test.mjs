import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExperimentationStudioSnapshot, createExperimentationStudioDashboardRoutes, createExperimentationStudioApiRoutes, createExperimentationStudioOpsRoutes, createExperimentationStudioPublicRoutes, createExperimentationStudioRegistryRoutes, summarizeExperimentationStudioFixtures } from '../packages/experimentation-studio/index.mjs';

test('experimentation-studio generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildExperimentationStudioSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createExperimentationStudioDashboardRoutes().length, 3);
  assert.equal(createExperimentationStudioApiRoutes().length, 4);
  assert.equal(createExperimentationStudioOpsRoutes().length, 3);
  assert.equal(createExperimentationStudioPublicRoutes().length, 3);
  assert.equal(createExperimentationStudioRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeExperimentationStudioFixtures().contacts, 2);
});

