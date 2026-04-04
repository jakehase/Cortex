import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAcquisitionNavigatorSnapshot, createAcquisitionNavigatorDashboardRoutes, createAcquisitionNavigatorApiRoutes, createAcquisitionNavigatorOpsRoutes, createAcquisitionNavigatorPublicRoutes, createAcquisitionNavigatorRegistryRoutes, summarizeAcquisitionNavigatorFixtures } from '../packages/acquisition-navigator/index.mjs';

test('acquisition-navigator generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAcquisitionNavigatorSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAcquisitionNavigatorDashboardRoutes().length, 3);
  assert.equal(createAcquisitionNavigatorApiRoutes().length, 4);
  assert.equal(createAcquisitionNavigatorOpsRoutes().length, 3);
  assert.equal(createAcquisitionNavigatorPublicRoutes().length, 3);
  assert.equal(createAcquisitionNavigatorRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAcquisitionNavigatorFixtures().contacts, 2);
});

