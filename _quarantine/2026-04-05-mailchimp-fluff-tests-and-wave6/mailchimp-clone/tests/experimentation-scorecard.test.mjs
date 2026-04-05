import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExperimentationScorecardSnapshot, createExperimentationScorecardDashboardRoutes, createExperimentationScorecardApiRoutes, createExperimentationScorecardOpsRoutes, createExperimentationScorecardPublicRoutes, createExperimentationScorecardRegistryRoutes, summarizeExperimentationScorecardFixtures } from '../packages/experimentation-scorecard/index.mjs';

test('experimentation-scorecard generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildExperimentationScorecardSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createExperimentationScorecardDashboardRoutes().length, 3);
  assert.equal(createExperimentationScorecardApiRoutes().length, 4);
  assert.equal(createExperimentationScorecardOpsRoutes().length, 3);
  assert.equal(createExperimentationScorecardPublicRoutes().length, 3);
  assert.equal(createExperimentationScorecardRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeExperimentationScorecardFixtures().contacts, 2);
});

