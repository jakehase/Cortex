import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAcquisitionCockpitSnapshot, createAcquisitionCockpitDashboardRoutes, createAcquisitionCockpitApiRoutes, createAcquisitionCockpitOpsRoutes, createAcquisitionCockpitPublicRoutes, createAcquisitionCockpitRegistryRoutes, summarizeAcquisitionCockpitFixtures } from '../packages/acquisition-cockpit/index.mjs';

test('acquisition-cockpit generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAcquisitionCockpitSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAcquisitionCockpitDashboardRoutes().length, 3);
  assert.equal(createAcquisitionCockpitApiRoutes().length, 4);
  assert.equal(createAcquisitionCockpitOpsRoutes().length, 3);
  assert.equal(createAcquisitionCockpitPublicRoutes().length, 3);
  assert.equal(createAcquisitionCockpitRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAcquisitionCockpitFixtures().contacts, 2);
});

