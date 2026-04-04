import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExperimentationAdvisorSnapshot, createExperimentationAdvisorDashboardRoutes, createExperimentationAdvisorApiRoutes, createExperimentationAdvisorOpsRoutes, createExperimentationAdvisorPublicRoutes, createExperimentationAdvisorRegistryRoutes, summarizeExperimentationAdvisorFixtures } from '../packages/experimentation-advisor/index.mjs';

test('experimentation-advisor generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildExperimentationAdvisorSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createExperimentationAdvisorDashboardRoutes().length, 3);
  assert.equal(createExperimentationAdvisorApiRoutes().length, 4);
  assert.equal(createExperimentationAdvisorOpsRoutes().length, 3);
  assert.equal(createExperimentationAdvisorPublicRoutes().length, 3);
  assert.equal(createExperimentationAdvisorRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeExperimentationAdvisorFixtures().contacts, 2);
});

