import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAcquisitionWorkbenchSnapshot, createAcquisitionWorkbenchDashboardRoutes, createAcquisitionWorkbenchApiRoutes, createAcquisitionWorkbenchOpsRoutes, createAcquisitionWorkbenchPublicRoutes, createAcquisitionWorkbenchRegistryRoutes, summarizeAcquisitionWorkbenchFixtures } from '../packages/acquisition-workbench/index.mjs';

test('acquisition-workbench generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAcquisitionWorkbenchSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAcquisitionWorkbenchDashboardRoutes().length, 3);
  assert.equal(createAcquisitionWorkbenchApiRoutes().length, 4);
  assert.equal(createAcquisitionWorkbenchOpsRoutes().length, 3);
  assert.equal(createAcquisitionWorkbenchPublicRoutes().length, 3);
  assert.equal(createAcquisitionWorkbenchRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAcquisitionWorkbenchFixtures().contacts, 2);
});

