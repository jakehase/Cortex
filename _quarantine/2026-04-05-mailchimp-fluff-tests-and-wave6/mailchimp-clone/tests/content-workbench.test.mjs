import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContentWorkbenchSnapshot, createContentWorkbenchDashboardRoutes, createContentWorkbenchApiRoutes, createContentWorkbenchOpsRoutes, createContentWorkbenchPublicRoutes, createContentWorkbenchRegistryRoutes, summarizeContentWorkbenchFixtures } from '../packages/content-workbench/index.mjs';

test('content-workbench generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildContentWorkbenchSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createContentWorkbenchDashboardRoutes().length, 3);
  assert.equal(createContentWorkbenchApiRoutes().length, 4);
  assert.equal(createContentWorkbenchOpsRoutes().length, 3);
  assert.equal(createContentWorkbenchPublicRoutes().length, 3);
  assert.equal(createContentWorkbenchRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeContentWorkbenchFixtures().contacts, 2);
});

