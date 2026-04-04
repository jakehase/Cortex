import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAcquisitionStudioSnapshot, createAcquisitionStudioDashboardRoutes, createAcquisitionStudioApiRoutes, createAcquisitionStudioOpsRoutes, createAcquisitionStudioPublicRoutes, createAcquisitionStudioRegistryRoutes, summarizeAcquisitionStudioFixtures } from '../packages/acquisition-studio/index.mjs';

test('acquisition-studio generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAcquisitionStudioSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAcquisitionStudioDashboardRoutes().length, 3);
  assert.equal(createAcquisitionStudioApiRoutes().length, 4);
  assert.equal(createAcquisitionStudioOpsRoutes().length, 3);
  assert.equal(createAcquisitionStudioPublicRoutes().length, 3);
  assert.equal(createAcquisitionStudioRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAcquisitionStudioFixtures().contacts, 2);
});

