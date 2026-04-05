import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCreativeWorkbenchSnapshot, createCreativeWorkbenchDashboardRoutes, createCreativeWorkbenchApiRoutes, createCreativeWorkbenchOpsRoutes, createCreativeWorkbenchPublicRoutes, createCreativeWorkbenchRegistryRoutes, summarizeCreativeWorkbenchFixtures } from '../packages/creative-workbench/index.mjs';

test('creative-workbench generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildCreativeWorkbenchSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createCreativeWorkbenchDashboardRoutes().length, 3);
  assert.equal(createCreativeWorkbenchApiRoutes().length, 4);
  assert.equal(createCreativeWorkbenchOpsRoutes().length, 3);
  assert.equal(createCreativeWorkbenchPublicRoutes().length, 3);
  assert.equal(createCreativeWorkbenchRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeCreativeWorkbenchFixtures().contacts, 2);
});

