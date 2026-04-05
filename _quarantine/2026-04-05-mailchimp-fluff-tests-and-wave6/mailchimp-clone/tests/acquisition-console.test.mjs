import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAcquisitionConsoleSnapshot, createAcquisitionConsoleDashboardRoutes, createAcquisitionConsoleApiRoutes, createAcquisitionConsoleOpsRoutes, createAcquisitionConsolePublicRoutes, createAcquisitionConsoleRegistryRoutes, summarizeAcquisitionConsoleFixtures } from '../packages/acquisition-console/index.mjs';

test('acquisition-console generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildAcquisitionConsoleSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createAcquisitionConsoleDashboardRoutes().length, 3);
  assert.equal(createAcquisitionConsoleApiRoutes().length, 4);
  assert.equal(createAcquisitionConsoleOpsRoutes().length, 3);
  assert.equal(createAcquisitionConsolePublicRoutes().length, 3);
  assert.equal(createAcquisitionConsoleRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeAcquisitionConsoleFixtures().contacts, 2);
});

