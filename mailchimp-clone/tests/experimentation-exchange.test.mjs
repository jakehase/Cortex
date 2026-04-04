import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExperimentationExchangeSnapshot, createExperimentationExchangeDashboardRoutes, createExperimentationExchangeApiRoutes, createExperimentationExchangeOpsRoutes, createExperimentationExchangePublicRoutes, createExperimentationExchangeRegistryRoutes, summarizeExperimentationExchangeFixtures } from '../packages/experimentation-exchange/index.mjs';

test('experimentation-exchange generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildExperimentationExchangeSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createExperimentationExchangeDashboardRoutes().length, 3);
  assert.equal(createExperimentationExchangeApiRoutes().length, 4);
  assert.equal(createExperimentationExchangeOpsRoutes().length, 3);
  assert.equal(createExperimentationExchangePublicRoutes().length, 3);
  assert.equal(createExperimentationExchangeRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeExperimentationExchangeFixtures().contacts, 2);
});

