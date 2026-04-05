import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAcquisitionWatchtowerSnapshot, createAcquisitionWatchtowerDashboardRoutes, createAcquisitionWatchtowerApiRoutes, createAcquisitionWatchtowerOpsRoutes, createAcquisitionWatchtowerPublicRoutes, createAcquisitionWatchtowerRegistryRoutes, summarizeAcquisitionWatchtowerFixtures } from '../packages/acquisition-watchtower/index.mjs';

test('acquisition-watchtower generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAcquisitionWatchtowerSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAcquisitionWatchtowerDashboardRoutes().length, 3);
  assert.equal(createAcquisitionWatchtowerApiRoutes().length, 4);
  assert.equal(createAcquisitionWatchtowerOpsRoutes().length, 3);
  assert.equal(createAcquisitionWatchtowerPublicRoutes().length, 3);
  assert.equal(createAcquisitionWatchtowerRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAcquisitionWatchtowerFixtures().contacts, 2);
});

