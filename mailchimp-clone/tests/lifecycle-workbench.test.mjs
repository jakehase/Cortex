import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLifecycleWorkbenchSnapshot, createLifecycleWorkbenchDashboardRoutes, createLifecycleWorkbenchApiRoutes, createLifecycleWorkbenchOpsRoutes, createLifecycleWorkbenchPublicRoutes, createLifecycleWorkbenchRegistryRoutes, summarizeLifecycleWorkbenchFixtures } from '../packages/lifecycle-workbench/index.mjs';

test('lifecycle-workbench generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildLifecycleWorkbenchSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createLifecycleWorkbenchDashboardRoutes().length, 3);
  assert.equal(createLifecycleWorkbenchApiRoutes().length, 4);
  assert.equal(createLifecycleWorkbenchOpsRoutes().length, 3);
  assert.equal(createLifecycleWorkbenchPublicRoutes().length, 3);
  assert.equal(createLifecycleWorkbenchRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeLifecycleWorkbenchFixtures().contacts, 2);
});

