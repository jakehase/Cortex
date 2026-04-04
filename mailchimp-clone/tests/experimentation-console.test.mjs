import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExperimentationConsoleSnapshot, createExperimentationConsoleDashboardRoutes, createExperimentationConsoleApiRoutes, createExperimentationConsoleOpsRoutes, createExperimentationConsolePublicRoutes, createExperimentationConsoleRegistryRoutes, summarizeExperimentationConsoleFixtures } from '../packages/experimentation-console/index.mjs';

test('experimentation-console generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildExperimentationConsoleSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createExperimentationConsoleDashboardRoutes().length, 3);
  assert.equal(createExperimentationConsoleApiRoutes().length, 4);
  assert.equal(createExperimentationConsoleOpsRoutes().length, 3);
  assert.equal(createExperimentationConsolePublicRoutes().length, 3);
  assert.equal(createExperimentationConsoleRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeExperimentationConsoleFixtures().contacts, 2);
});

