import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDeliverabilityWorkbenchSnapshot, createDeliverabilityWorkbenchDashboardRoutes, createDeliverabilityWorkbenchApiRoutes, createDeliverabilityWorkbenchOpsRoutes, createDeliverabilityWorkbenchPublicRoutes, createDeliverabilityWorkbenchRegistryRoutes, summarizeDeliverabilityWorkbenchFixtures } from '../packages/deliverability-workbench/index.mjs';

test('deliverability-workbench generated scale surface stays executable and policy-complete', () => {
  const snapshot = buildDeliverabilityWorkbenchSnapshot('Wave Seven Workspace');
  assert.equal(snapshot.summary.workspaceName, 'Wave Seven Workspace');
  assert.equal(snapshot.validation.ok, true);
  assert.equal(createDeliverabilityWorkbenchDashboardRoutes().length, 3);
  assert.equal(createDeliverabilityWorkbenchApiRoutes().length, 4);
  assert.equal(createDeliverabilityWorkbenchOpsRoutes().length, 3);
  assert.equal(createDeliverabilityWorkbenchPublicRoutes().length, 3);
  assert.equal(createDeliverabilityWorkbenchRegistryRoutes().length, 3);
  assert.ok(snapshot.reporting.summary.totalCards >= 4);
  assert.ok(snapshot.audit.attestation.ok);
  assert.equal(summarizeDeliverabilityWorkbenchFixtures().contacts, 2);
});

