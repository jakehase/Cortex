import test from 'node:test';
import assert from 'node:assert/strict';
import { buildActivationWorkbenchSnapshot, createActivationWorkbenchDashboardRoutes, createActivationWorkbenchApiRoutes, createActivationWorkbenchOpsRoutes, createActivationWorkbenchPublicRoutes, createActivationWorkbenchRegistryRoutes, summarizeActivationWorkbenchFixtures } from '../packages/activation-workbench/index.mjs';

test('activation-workbench generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildActivationWorkbenchSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createActivationWorkbenchDashboardRoutes().length, 3);
  assert.equal(createActivationWorkbenchApiRoutes().length, 4);
  assert.equal(createActivationWorkbenchOpsRoutes().length, 3);
  assert.equal(createActivationWorkbenchPublicRoutes().length, 3);
  assert.equal(createActivationWorkbenchRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeActivationWorkbenchFixtures().contacts, 2);
});

