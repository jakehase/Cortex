import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAcquisitionGridSnapshot, createAcquisitionGridDashboardRoutes, createAcquisitionGridApiRoutes, createAcquisitionGridOpsRoutes, createAcquisitionGridPublicRoutes, createAcquisitionGridRegistryRoutes, summarizeAcquisitionGridFixtures } from '../packages/acquisition-grid/index.mjs';

test('acquisition-grid generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAcquisitionGridSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAcquisitionGridDashboardRoutes().length, 3);
  assert.equal(createAcquisitionGridApiRoutes().length, 4);
  assert.equal(createAcquisitionGridOpsRoutes().length, 3);
  assert.equal(createAcquisitionGridPublicRoutes().length, 3);
  assert.equal(createAcquisitionGridRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAcquisitionGridFixtures().contacts, 2);
});

