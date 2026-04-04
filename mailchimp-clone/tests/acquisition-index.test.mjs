import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAcquisitionIndexSnapshot, createAcquisitionIndexDashboardRoutes, createAcquisitionIndexApiRoutes, createAcquisitionIndexOpsRoutes, createAcquisitionIndexPublicRoutes, createAcquisitionIndexRegistryRoutes, summarizeAcquisitionIndexFixtures } from '../packages/acquisition-index/index.mjs';

test('acquisition-index generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAcquisitionIndexSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAcquisitionIndexDashboardRoutes().length, 3);
  assert.equal(createAcquisitionIndexApiRoutes().length, 4);
  assert.equal(createAcquisitionIndexOpsRoutes().length, 3);
  assert.equal(createAcquisitionIndexPublicRoutes().length, 3);
  assert.equal(createAcquisitionIndexRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAcquisitionIndexFixtures().contacts, 2);
});

