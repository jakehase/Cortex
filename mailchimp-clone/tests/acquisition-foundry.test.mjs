import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAcquisitionFoundrySnapshot, createAcquisitionFoundryDashboardRoutes, createAcquisitionFoundryApiRoutes, createAcquisitionFoundryOpsRoutes, createAcquisitionFoundryPublicRoutes, createAcquisitionFoundryRegistryRoutes, summarizeAcquisitionFoundryFixtures } from '../packages/acquisition-foundry/index.mjs';

test('acquisition-foundry generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAcquisitionFoundrySnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAcquisitionFoundryDashboardRoutes().length, 3);
  assert.equal(createAcquisitionFoundryApiRoutes().length, 4);
  assert.equal(createAcquisitionFoundryOpsRoutes().length, 3);
  assert.equal(createAcquisitionFoundryPublicRoutes().length, 3);
  assert.equal(createAcquisitionFoundryRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAcquisitionFoundryFixtures().contacts, 2);
});

