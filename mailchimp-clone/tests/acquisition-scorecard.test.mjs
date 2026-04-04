import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAcquisitionScorecardSnapshot, createAcquisitionScorecardDashboardRoutes, createAcquisitionScorecardApiRoutes, createAcquisitionScorecardOpsRoutes, createAcquisitionScorecardPublicRoutes, createAcquisitionScorecardRegistryRoutes, summarizeAcquisitionScorecardFixtures } from '../packages/acquisition-scorecard/index.mjs';

test('acquisition-scorecard generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAcquisitionScorecardSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAcquisitionScorecardDashboardRoutes().length, 3);
  assert.equal(createAcquisitionScorecardApiRoutes().length, 4);
  assert.equal(createAcquisitionScorecardOpsRoutes().length, 3);
  assert.equal(createAcquisitionScorecardPublicRoutes().length, 3);
  assert.equal(createAcquisitionScorecardRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAcquisitionScorecardFixtures().contacts, 2);
});

