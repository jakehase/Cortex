import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDataWorkbenchSnapshot, createDataWorkbenchDashboardRoutes, createDataWorkbenchApiRoutes, createDataWorkbenchOpsRoutes, createDataWorkbenchPublicRoutes, createDataWorkbenchRegistryRoutes, summarizeDataWorkbenchFixtures } from '../packages/data-workbench/index.mjs';

test('data-workbench generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildDataWorkbenchSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createDataWorkbenchDashboardRoutes().length, 3);
  assert.equal(createDataWorkbenchApiRoutes().length, 4);
  assert.equal(createDataWorkbenchOpsRoutes().length, 3);
  assert.equal(createDataWorkbenchPublicRoutes().length, 3);
  assert.equal(createDataWorkbenchRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeDataWorkbenchFixtures().contacts, 2);
});

