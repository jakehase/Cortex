import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExperimentationCockpitSnapshot, createExperimentationCockpitDashboardRoutes, createExperimentationCockpitApiRoutes, createExperimentationCockpitOpsRoutes, createExperimentationCockpitPublicRoutes, createExperimentationCockpitRegistryRoutes, summarizeExperimentationCockpitFixtures } from '../packages/experimentation-cockpit/index.mjs';

test('experimentation-cockpit generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildExperimentationCockpitSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createExperimentationCockpitDashboardRoutes().length, 3);
  assert.equal(createExperimentationCockpitApiRoutes().length, 4);
  assert.equal(createExperimentationCockpitOpsRoutes().length, 3);
  assert.equal(createExperimentationCockpitPublicRoutes().length, 3);
  assert.equal(createExperimentationCockpitRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeExperimentationCockpitFixtures().contacts, 2);
});

