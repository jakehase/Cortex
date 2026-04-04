import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExperimentationSentinelSnapshot, createExperimentationSentinelDashboardRoutes, createExperimentationSentinelApiRoutes, createExperimentationSentinelOpsRoutes, createExperimentationSentinelPublicRoutes, createExperimentationSentinelRegistryRoutes, summarizeExperimentationSentinelFixtures } from '../packages/experimentation-sentinel/index.mjs';

test('experimentation-sentinel generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildExperimentationSentinelSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createExperimentationSentinelDashboardRoutes().length, 3);
  assert.equal(createExperimentationSentinelApiRoutes().length, 4);
  assert.equal(createExperimentationSentinelOpsRoutes().length, 3);
  assert.equal(createExperimentationSentinelPublicRoutes().length, 3);
  assert.equal(createExperimentationSentinelRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeExperimentationSentinelFixtures().contacts, 2);
});

