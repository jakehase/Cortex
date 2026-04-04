import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAcquisitionHubSnapshot, createAcquisitionHubDashboardRoutes, createAcquisitionHubApiRoutes, createAcquisitionHubOpsRoutes, createAcquisitionHubPublicRoutes, createAcquisitionHubRegistryRoutes, summarizeAcquisitionHubFixtures } from '../packages/acquisition-hub/index.mjs';

test('acquisition-hub generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAcquisitionHubSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAcquisitionHubDashboardRoutes().length, 3);
  assert.equal(createAcquisitionHubApiRoutes().length, 4);
  assert.equal(createAcquisitionHubOpsRoutes().length, 3);
  assert.equal(createAcquisitionHubPublicRoutes().length, 3);
  assert.equal(createAcquisitionHubRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAcquisitionHubFixtures().contacts, 2);
});

