import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExperimentationAtlasSnapshot, createExperimentationAtlasDashboardRoutes, createExperimentationAtlasApiRoutes, createExperimentationAtlasOpsRoutes, createExperimentationAtlasPublicRoutes, createExperimentationAtlasRegistryRoutes, summarizeExperimentationAtlasFixtures } from '../packages/experimentation-atlas/index.mjs';

test('experimentation-atlas generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildExperimentationAtlasSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createExperimentationAtlasDashboardRoutes().length, 3);
  assert.equal(createExperimentationAtlasApiRoutes().length, 4);
  assert.equal(createExperimentationAtlasOpsRoutes().length, 3);
  assert.equal(createExperimentationAtlasPublicRoutes().length, 3);
  assert.equal(createExperimentationAtlasRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeExperimentationAtlasFixtures().contacts, 2);
});

